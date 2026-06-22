# BRIEFING — Agente de Suporte Inteligente do ZapScript.me

Status: **Bot autônomo no WhatsApp implementado** (canal WhatsApp via Evolution/QR).
Última atualização: 2026-06-19.

Este documento cobre o que já foi construído, como configurar e os próximos passos.

**Comportamento atual (mudou em 2026-06-19 — decisão do usuário):** o bot agora
**responde automaticamente** quando tem confiança alta e o caso não é sensível.
Casos sensíveis (cancelamento, cobrança, reclamação grave, baixa confiança) **NUNCA**
são respondidos automaticamente — ficam pendentes na fila do painel e o admin é avisado
por WhatsApp. A fila de aprovação continua existindo como rede de segurança para esses
casos e para edição/reenvio manual.

---

## 1. O que foi implementado neste MVP

| Módulo | Status | Onde |
|---|---|---|
| #01 Banco de dados | ✅ | `packages/database/prisma/schema.prisma` + migration `20260616_support_agent` |
| #02 Agente IA (classificar + gerar) | ✅ | `apps/api/src/services/support-agent.ts` |
| #03 Base de conhecimento (RAG) | ✅ por palavra-chave (pgvector = próximo passo) | mesmo arquivo + tabela `KnowledgeBase` |
| #05 Fila de aprovação (backend) | ✅ | `apps/api/src/routes/suporte-admin.ts` |
| #05 Painel de aprovação (UI) | ✅ | aba **Atendimento** em `apps/web/src/app/g5r8t2/admin-dashboard.tsx` (`SupportAgentTab`) |
| #09 Canal WhatsApp (webhook) | ✅ **Evolution API (QR)** | `apps/api/src/routes/suporte-whatsapp.ts` |
| #11/#12 Aprendizado + sugestões de FAQ | ✅ base | intake gera `FaqSuggestion`; aprovação vira `KnowledgeBase` |
| Notificações painel (tempo real) | ✅ | Socket.IO sala `admin:suporte` |
| **Mensagem inicial automática** | ✅ | `sendWelcome` em `services/support-send.ts` — só na 1ª mensagem da thread |
| **Auto-resolução (bot responde sozinho)** | ✅ | `support-intake.ts` — quando `!requer_escalacao` e não é spam |
| **Alerta ao admin no WhatsApp** | ✅ | `notifyAdminEscalation` em `services/support-send.ts` — usa `ADMIN_NOTIFY_PHONE` |

**Ainda não implementado (próximas fases):** canal Email inbound automático e Chat do
site, transcrição de áudio do WhatsApp via Whisper, RAG com pgvector/embeddings,
dashboard de métricas visual, relatório semanal.

---

## 2. Arquitetura (fluxo atual)

```
WhatsApp de suporte (instância Evolution dedicada, conectada por QR)
        │  webhook POST /webhook/suporte/whatsapp?secret=...
        ▼
 suporte-whatsapp.ts  ── valida secret, parseia messages.upsert, extrai texto
        ▼
 support-intake.ts    ── cria SupportAtendimento (pending_approval)
        │                 vincula usuário existente (LGPD), dedupe por messageId
        │                 1ª mensagem da thread → sendWelcome() (saudação automática)
        ▼
 support-agent.ts     ── retrieveKnowledge (RAG keyword) → Claude classifica + gera rascunho
        │                 aplica regras de escalação automática
        ▼
   ┌────────────────────────┴────────────────────────┐
   │ requer_escalacao = false (confiança alta,        │ requer_escalacao = true
   │ caso não sensível)                               │ (cancelamento/cobrança/baixa
   ▼                                                   │ confiança/reclamação grave/...)
 BOT RESPONDE SOZINHO                                  ▼
 sendOnChannel → Evolution sendText               Fica pendente na fila (painel)
 status = "sent" (resolvido)                       + notifyAdminEscalation()
                                                    → alerta no SEU WhatsApp (ADMIN_NOTIFY_PHONE)
                                                    ▼
                                          Admin aprova/edita/escala/spam/regenera
                                          (aba Atendimento em /g5r8t2)
```

**Regra de ouro preservada:** mesmo no modo automático, o bot só responde quando o
agente classifica como **não-sensível e de alta confiança**. Cancelamento, cobrança,
reembolso e reclamações graves **sempre** caem na fila humana — nunca são respondidos
pelo bot (ver regras em `applyEscalationRules`, §8).

---

## 3. Stack utilizada (versões do repo)

- API: Fastify + TypeScript, Socket.IO
- IA: `@anthropic-ai/sdk@0.24.3`, modelo default `claude-sonnet-4-6` (override por env)
- DB: PostgreSQL (Supabase) + Prisma `5.22.0`
- WhatsApp: **Evolution API (QR)** — instância dedicada de suporte, `sendText` em `services/evolution.ts`
- Email (envio de resposta no canal email): Resend via `lib/mailer.ts`

---

## 4. Variáveis de ambiente necessárias

| Variável | Uso | Já existe? |
|---|---|---|
| `ANTHROPIC_API_KEY` | chamadas ao agente | ✅ |
| `SUPPORT_AGENT_MODEL` | (opcional) override do modelo, ex. `claude-sonnet-4-6` | novo, opcional |
| `ADMIN_TOKEN` | auth do painel (`x-admin-token`) | ✅ |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | acesso à Evolution API | ✅ |
| `SUPPORT_EVOLUTION_INSTANCE` | nome da instância Evolution de suporte (ex. `zs-suporte`) — usada p/ ENVIAR respostas (auto e manual) | **novo, obrigatório** |
| `SUPPORT_EVOLUTION_WEBHOOK_SECRET` | valida o `?secret=` do webhook | novo (fallback p/ `EVOLUTION_WEBHOOK_SECRET`) |
| `ADMIN_NOTIFY_PHONE` | **seu número** — recebe o alerta quando um atendimento precisa de você | já existe (usado pelo Health Monitor) — reaproveitado aqui |
| `SUPPORT_WELCOME_MSG` | (opcional) personaliza a saudação inicial — senão usa um texto padrão | novo, opcional |

---

## 5. Configurar o WhatsApp de suporte (Evolution API, por QR)

A ideia: um **número de WhatsApp exclusivo de atendimento** (chip/linha separada do seu
pessoal), conectado a uma **instância Evolution dedicada** — diferente das instâncias dos
usuários do produto de transcrição.

1. **Criar a instância de suporte** no seu Evolution (ex. nome `zs-suporte`). Pode ser
   pelo manager do Evolution ou via API:
   ```bash
   curl -X POST "$EVOLUTION_API_URL/instance/create" \
     -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"zs-suporte","integration":"WHATSAPP-BAILEYS","groupsIgnore":true}'
   ```
2. Defina no Render: `SUPPORT_EVOLUTION_INSTANCE=zs-suporte` e
   `SUPPORT_EVOLUTION_WEBHOOK_SECRET=<um segredo forte>`.
3. **Registrar o webhook** da instância apontando para a API (só o evento de mensagens):
   ```bash
   curl -X POST "$EVOLUTION_API_URL/webhook/set/zs-suporte" \
     -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
     -d '{"webhook":{"enabled":true,"url":"https://SUA_API/webhook/suporte/whatsapp?secret=<MESMO_SEGREDO>","events":["MESSAGES_UPSERT"]}}'
   ```
   > O formato exato do payload do `/webhook/set` varia entre versões do Evolution;
   > pelo manager basta colar a URL com `?secret=` e marcar **MESSAGES_UPSERT**.
4. **Conectar o número**: gere o QR da instância (`GET $EVOLUTION_API_URL/instance/connect/zs-suporte`
   ou pelo manager) e escaneie com o celular do número de suporte
   (WhatsApp > Aparelhos conectados).
5. Envie um texto ao número de suporte e confira em `GET /sys/g5r8t2/suporte/queue`
   (ou abra a aba **Atendimento** no painel `/g5r8t2`).

> Envio das respostas: ao aprovar, a API usa `sendText(SUPPORT_EVOLUTION_INSTANCE, ...)`,
> ou seja, responde pelo MESMO número de suporte conectado.

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

## 10. Como organizar os e-mails da empresa (recomendação)

Hoje o `contato@zapscript.me` (Zoho) recebe tudo misturado. Sugestão de organização —
**simples, barata e que prepara o terreno para o canal de e-mail do agente**:

**a) Estrutura de endereços (aliases do mesmo domínio):**
- `contato@zapscript.me` → entrada geral / comercial (o que já existe).
- `suporte@zapscript.me` → **fila de atendimento** (é este que o agente vai consumir).
- `financeiro@zapscript.me` → cobrança/Asaas/notas (separa o que é crítico/LGPD).
- `nao-responda@zapscript.me` → já usado como remetente dos e-mails transacionais.
- (opcional) `parcerias@` / `afiliados@`.

Crie todos como **aliases/encaminhamentos** para uma caixa principal — não precisa de uma
licença paga por endereço.

**b) Qual app usar:**
- **Continuar no Zoho Mail** é a opção mais econômica e suficiente: permite vários
  aliases, pastas/labels e regras de filtro. Recomendado para o estágio atual.
- **Google Workspace** só se você já vive no ecossistema Google e quer Gmail/Drive
  integrados (custa mais por usuário). Não é necessário agora.
- Evite caixas pessoais (Gmail comum) para suporte — dificulta automação e passa imagem
  menos profissional.

**c) Como organizar dentro da caixa (Zoho):**
- Pastas/labels por tema: `Suporte`, `Cobrança`, `Comercial`, `Spam`.
- Regras de filtro: e-mails para `suporte@` → pasta Suporte; assuntos com
  "reembolso/cancelar/cobrança" → marcar e priorizar (essas categorias o agente escala).
- Resposta padrão de recebimento ("recebemos seu contato, retornamos em até X").

**d) Caminho para automatizar com o agente (próxima fase — ainda não implementado):**
1. **Mais simples:** criar uma **regra no Zoho** que encaminhe cópia de `suporte@` para um
   endereço de ingestão, OU usar **IMAP polling** (um worker lê a caixa a cada X min e
   chama `intakeMessage({canal:'email', ...})`).
2. **Mais robusto:** apontar o MX/inbound de um subdomínio (ex. `inbound.zapscript.me`)
   para o **Inbound do Resend** (ou Mailgun/SendGrid), que faz POST num webhook
   `/webhook/suporte/email` → `intakeMessage`. O envio das respostas aprovadas já está
   pronto (`sendEmail` via Resend), então só falta o **inbound**.

> Recomendação prática: comece com Zoho + aliases + regras (passo a–c) ainda hoje, e deixe
> a ingestão automática (d) como o próximo incremento. O agente já responde e-mail no
> fluxo de aprovação assim que um atendimento `canal:'email'` é criado.

---

## 11. Próximos passos sugeridos (ordem)

1. Go-live do WhatsApp de suporte (instância Evolution `zs-suporte` + QR) — ver §5/§12.
2. Canal Email inbound automático (IMAP polling do `suporte@` ou Inbound Resend) — §10.d.
3. Transcrição de áudio do WhatsApp via Whisper antes do intake.
4. Canal Chat do site (Socket.IO + widget).
5. RAG com pgvector/embeddings (substituir busca por palavra-chave).
6. Notificações ao admin por email/WhatsApp + relatório semanal.
7. Histórico/timeline por cliente e dashboard de métricas visual.

---

## 12. Checklist de go-live

- [ ] Aplicar a migração `20260616_support_agent` em produção (Supabase) — §6.
- [ ] `npm run db:generate` (cada app tem sua cópia do client).
- [ ] Semear a base de conhecimento (`seed-support-kb.ts`) — §6.
- [ ] Criar a instância Evolution `zs-suporte` e definir
      `SUPPORT_EVOLUTION_INSTANCE` + `SUPPORT_EVOLUTION_WEBHOOK_SECRET` no Render — §5.
- [ ] Definir `ADMIN_NOTIFY_PHONE` no Render (seu número, para receber os alertas de escalação).
- [ ] Registrar o webhook `MESSAGES_UPSERT` da instância → `/webhook/suporte/whatsapp?secret=` — §5.
- [ ] Conectar o número de suporte pelo QR — §5.
- [ ] Deploy da API e do web (Render/Vercel).
- [ ] Teste ponta a ponta — caso simples (deve auto-resolver): mandar "como conecto meu
      número?" → confirmar que chega a saudação e depois a resposta automática, SEM
      passar pelo painel.
- [ ] Teste ponta a ponta — caso sensível (deve escalar): mandar algo com "cancelar" ou
      "reembolso" → confirmar que NÃO chega resposta automática, que você recebe o
      alerta no seu WhatsApp, e que o caso aparece pendente na aba **Atendimento**.
