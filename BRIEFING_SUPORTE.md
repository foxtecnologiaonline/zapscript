# BRIEFING — Agente de Suporte Inteligente do ZapScript.me

Status: **MVP do core implementado** (canal WhatsApp Business primeiro).
Data: 2026-06-16.

Este documento cobre o que já foi construído, como configurar e os próximos passos.
A regra de ouro do briefing original é respeitada: **nenhuma resposta vai ao cliente sem
aprovação humana no painel**.

---

## 1. O que foi implementado neste MVP

| Módulo | Status | Onde |
|---|---|---|
| #01 Banco de dados | ✅ | `packages/database/prisma/schema.prisma` + migration `20260616_support_agent` |
| #02 Agente IA (classificar + gerar) | ✅ | `apps/api/src/services/support-agent.ts` |
| #03 Base de conhecimento (RAG) | ✅ por palavra-chave (pgvector = próximo passo) | mesmo arquivo + tabela `KnowledgeBase` |
| #05 Fila de aprovação (backend) | ✅ | `apps/api/src/routes/suporte-admin.ts` |
| #09 Canal WhatsApp Business (webhook) | ✅ | `apps/api/src/routes/suporte-whatsapp.ts` |
| #11/#12 Aprendizado + sugestões de FAQ | ✅ base | intake gera `FaqSuggestion`; aprovação vira `KnowledgeBase` |
| Notificações painel (tempo real) | ✅ | Socket.IO sala `admin:suporte` |

**Ainda não implementado (próximas fases):** UI do painel (React), canais Email e Chat
do site, transcrição de áudio do WhatsApp via Whisper, RAG com pgvector/embeddings,
dashboard de métricas visual, relatório semanal, notificações por email/WhatsApp ao admin.

---

## 2. Arquitetura (fluxo atual)

```
WhatsApp Business (Meta Cloud API)
        │  webhook POST /webhook/suporte/whatsapp
        ▼
 suporte-whatsapp.ts  ── valida assinatura HMAC, extrai texto
        ▼
 support-intake.ts    ── cria SupportAtendimento (pending_approval)
        │                 vincula usuário existente (LGPD), dedupe por messageId
        ▼
 support-agent.ts     ── retrieveKnowledge (RAG keyword) → Claude classifica + gera rascunho
        │                 aplica regras de escalação automática
        ▼
 SupportAtendimento (rascunho salvo) + FaqSuggestion (se houver) + emit Socket.IO
        ▼
 Painel admin (GET /sys/g5r8t2/suporte/queue)
        ▼
 Admin aprova/edita/escala/spam/regenera
        ▼
 approve → sendOnChannel → whatsappAPI.sendMessage → status "sent"
```

---

## 3. Stack utilizada (versões do repo)

- API: Fastify + TypeScript, Socket.IO
- IA: `@anthropic-ai/sdk@0.24.3`, modelo default `claude-sonnet-4-6` (override por env)
- DB: PostgreSQL (Supabase) + Prisma `5.22.0`
- WhatsApp: Meta Cloud API (`whatsappAPI` em `services/whatsapp-official.ts`)
- Email (envio de resposta no canal email): Resend via `lib/mailer.ts`

---

## 4. Variáveis de ambiente necessárias

| Variável | Uso | Já existe? |
|---|---|---|
| `ANTHROPIC_API_KEY` | chamadas ao agente | ✅ |
| `SUPPORT_AGENT_MODEL` | (opcional) override do modelo, ex. `claude-sonnet-4-6` | novo, opcional |
| `ADMIN_TOKEN` | auth do painel (`x-admin-token`) | ✅ |
| `SUPPORT_WHATSAPP_WEBHOOK_TOKEN` | verificação GET do webhook (hub.verify_token) | novo (fallback p/ `WHATSAPP_WEBHOOK_TOKEN`) |
| `SUPPORT_WHATSAPP_APP_SECRET` | valida `x-hub-signature-256` | novo (fallback p/ `WHATSAPP_APP_SECRET`) |
| `WHATSAPP_API_TOKEN` / phone number id (Meta) | envio das respostas aprovadas | ✅ |

---

## 5. Configurar o webhook do WhatsApp (Meta)

1. No painel da Meta (WhatsApp > Configuration), defina o **Callback URL**:
   `https://SEU_DOMINIO/webhook/suporte/whatsapp`
2. **Verify token** = valor de `SUPPORT_WHATSAPP_WEBHOOK_TOKEN`.
3. Assine o campo `messages`.
4. Defina `SUPPORT_WHATSAPP_APP_SECRET` = App Secret do app Meta (valida a assinatura).
5. Envie um texto ao número de suporte e confira em `GET /sys/g5r8t2/suporte/queue`.

> Observação: o envio das respostas usa o número Meta já configurado no produto
> (`whatsappAPI`). Para um número de atendimento dedicado, configure um phone number id
> próprio no `services/whatsapp-official.ts` (próximo passo).

---

## 6. Aplicar a migração e semear a base

```bash
# Migração (cria SupportAtendimento, KnowledgeBase, FaqSuggestion)
cd packages/database && npx prisma migrate deploy
# ou aplique manualmente prisma/migrations/20260616_support_agent/migration.sql no SQL Editor do Supabase

# Gerar o client (cada app tem sua cópia)
npm run db:generate

# Semear a base de conhecimento inicial (planos, conexão, erros, cobrança, LGPD)
cd packages/database && npx ts-node --project tsconfig.json prisma/seed-support-kb.ts
```

---

## 7. API do painel admin (prefixo `/sys/g5r8t2/suporte`, header `x-admin-token`)

| Método | Rota | Ação |
|---|---|---|
| GET | `/queue?status=&canal=&limit=&offset=` | fila de aprovação (default `pending_approval`) |
| GET | `/atendimento/:id` | detalhe de um atendimento |
| POST | `/atendimento/:id/approve` `{resposta?}` | aprova e envia (texto opcional = edição) |
| POST | `/atendimento/:id/edit` `{resposta}` | salva edição sem enviar |
| POST | `/atendimento/:id/regenerate` `{instrucao?}` | pede nova versão ao agente |
| POST | `/atendimento/:id/escalate` | escala para humano |
| POST | `/atendimento/:id/spam` | marca como spam |
| GET | `/metrics` | volume, taxa de edição/escalação, por canal/categoria |
| GET/POST/DELETE | `/knowledge` | gerir base de conhecimento |
| GET | `/faq-suggestions?status=` | sugestões pendentes |
| POST | `/faq-suggestions/:id/approve` | aprova sugestão → vira tópico na base |
| POST | `/faq-suggestions/:id/ignore` | descarta sugestão |

Notificação em tempo real: o painel deve emitir `join:suporte` no socket (usuário admin)
e ouvir `suporte:novo` e `suporte:atualizado`.

---

## 8. Regras de escalação automática (em `support-agent.ts`)

Escala para humano quando: confiança < 70%; categoria cancelamento/cobrança;
reclamação com sentimento frustrado ou prioridade urgente; frustrado + alta prioridade;
menção a reembolso/processo/PROCON/cancelar/advogado. **Não pode ser desativado** para
essas categorias críticas.

---

## 9. Aprendizado contínuo

- Toda edição do admin marca `editadoPeloAdmin=true` (insumo de treino futuro).
- O agente sugere novos tópicos de FAQ → `FaqSuggestion` (fila no painel).
- A base de conhecimento só é atualizada com **aprovação explícita** do admin
  (POST `/faq-suggestions/:id/approve` ou POST `/knowledge`).

---

## 10. Próximos passos sugeridos (ordem)

1. UI do painel `/g5r8t2/suporte` (fila + card de aprovação + base + métricas).
2. Transcrição de áudio do WhatsApp via Whisper antes do intake.
3. Canal Email (webhook inbound Resend) e Canal Chat do site (Socket.IO + widget).
4. RAG com pgvector/embeddings (substituir busca por palavra-chave).
5. Notificações ao admin por email/WhatsApp + relatório semanal.
6. Histórico/timeline por cliente e dashboard de métricas visual.
