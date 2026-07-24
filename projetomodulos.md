# Projeto ZapScript Módulos — Visão Geral

> Documento-mestre da transformação do **ZapScript.me** de produto único (transcrição de
> áudios do WhatsApp) em **plataforma modular**: um login, vários módulos contratáveis
> à la carte, cada usuário vendo apenas o que assinou.
>
> Este arquivo é o **índice executivo**. O detalhe técnico está em:
> - `MODULOS_ARQUITETURA.md` — titularidade (entitlements), billing, controle de acesso.
> - `PLATAFORMA_BASE.md` — kernel + módulos + barramento de eventos (integração).
> - `packages/modules/catalog.ts` — **fonte única da verdade** do catálogo (código).

Data: 2026-07-08 · Branch: `claude/zapscript-modules-nv95eb`

---

## 1. A transformação em uma frase

> Deixar de ser **"o app de transcrição"** e passar a ser **a base comum (kernel)** onde
> módulos plugam — reusando a mesma infraestrutura já validada (mensageria, IA, billing,
> identidade, storage, observabilidade). Nenhum módulo novo constrói infra nova.

**Antes:** `User → 1 Subscription → 1 Plan` (free/pro). Receber mensagem = transcrever (soldados).
**Depois:** `User → N Entitlements` (à la carte) sobre um **kernel** que distribui cada evento
de entrada para os módulos ativos via um **barramento** (Redis/BullMQ já existentes).

---

## 2. Como fica a arquitetura (resumo)

```
                    ┌──────────────────── KERNEL (base comum) ────────────────────┐
   WhatsApp / IG ──►│ Messaging Gateway (entrada) → normaliza → messages.inbound  │
   webhooks         │ Dispatcher: fan-out por titularidade (entitlement)          │
                    │ Identidade/SSO · Billing · Motor de IA · Storage · Obs.      │
                    └───┬───────────┬───────────┬───────────┬───────────┬─────────┘
                        ▼           ▼           ▼           ▼           ▼
                     [core]     [atende]     [crm]     [cobranca]   [campanhas] …  ← MÓDULOS
                        └───────────┴─── enviam via ──► Messaging Gateway (saída) ─►
```

- **Kernel = capacidades** compartilhadas.
- **Módulo = plugin** que implementa um contrato (`ZapModule`) e recebe o kernel por injeção.
- **Integração = barramento**: entrada normalizada → fan-out por entitlement → saída única.
- **Login único (SSO)**: um cadastro/sessão; o launcher `/app` mostra só os módulos contratados.
- **Billing**: 1 assinatura Asaas agregada (valor = Σ módulos ativos) — 1 fatura para o cliente.

---

## 3. Catálogo completo de módulos

Preços são **proposta** (validar com pricing). Fonte de dados: `packages/modules/catalog.ts`.

| # | Módulo | Key | O que faz (JTBD) | Reusa | Preço/mês | Status | Fase |
|---|--------|-----|------------------|-------|-----------|--------|------|
| 1 | **ZapScript** (Transcrição) | `core` | Transcreve e resume áudios do WhatsApp. "Não tenho tempo de ouvir áudio longo." | mensageria, IA | R$ 37 (PRO) | **GA** | 0 |
| 2 | **ZapScript Atende** | `atende` | Atendimento automático 24/7. "Responder cliente na hora sem contratar equipe." | mensageria, IA, KB | R$ 67 | **Beta** | 1 |
| 3 | **ZapScript Cobrança** | `cobranca` | Lembrete/cobrança automática (venceu, vence hoje, 2ª via). Dor #1 do MEI: inadimplência. | mensageria (100%) | R$ 39 | Planejado | 2 |
| 4 | **ZapScript Campanhas** | `campanhas` | Disparo em massa *compliant* via API oficial. Janela Meta (dez/2025) órfãos de bots. | WhatsApp oficial | R$ 67 | Planejado | 3 |
| 5 | **ZapScript CRM** (Gestão Clientes) | `crm` | Funil no WhatsApp (novo lead → negociando → fechado). Gap entre "responder" e "vender". | mensageria, conversas | R$ 47 | Planejado | 4 |
| 6 | **Atende Qualidade** | `atende-qualidade` | Dashboard das conversas do Atende: tempo de resposta, sentimento, conversão. "O bot tá funcionando?" | dados do Atende, IA | R$ 27 | Planejado (**requer Atende**) | 4 |
| 7 | **ZapScript Legendas** | `legenda` | Legenda automática de Reels/Stories. ICP novo (criador de conteúdo). Só nova interface sobre o Whisper. | transcrição | R$ 37 | Planejado | 5 |
| 8 | **ZapScript Vendas** | `vendas` | Vendedor grava visita/ligação → transcreve/resume → nota no CRM. Registro de atividade comercial. | transcrição, IA | R$ 57 | Planejado (sinergia c/ CRM) | 5 |
| 9 | **ZapScript Multicanal** | `multicanal` | Todos os módulos ZapScript replicados no Instagram, Facebook e Telegram. Aposta mais especulativa. | transcrição, IA, mensageria | R$ 27 | **Discovery** (validar com 5) | 6 |

**Dependências:** `atende-qualidade` → requer `atende`. `vendas` tem sinergia (não
dependência dura) com `crm`. As dependências vivem no catálogo (`dependsOn`) e são aplicadas
no checkout e no gate de acesso.

---

## 4. Roadmap por fases (valor × urgência × reuso)

| Fase | Entrega | Situação |
|------|---------|----------|
| **0 — Fundação** | Registry do catálogo + arquitetura documentada | ✅ **Feito** |
| **1 — Plataforma de entitlements** | Models `Product`/`Entitlement` + migração + backfill `core` + `requireModule` + `modules` no `/auth/me` + launcher `/app` + provisionamento no billing (subscribe/cancel com proração) | ✅ **Feito** |
| **2 — Cobrança** | 1º módulo pago novo (reusa 100% mensageria; dor #1 do MEI) | ⏳ Próximo |
| **3 — Campanhas** | Aproveitar a janela Meta (dez/2025) — alternativa compliant | ⏳ |
| **4 — CRM + Atende Qualidade** | Cross-sell com Atende; fecha "responder → vender → medir" | ⏳ |
| **5 — Legendas / ZapScript Vendas** | ICP novo e sinergia comercial; baixo risco técnico | ⏳ |
| **6 — Multicanal** | Discovery — validar com 5 conversas antes de investir | ⏳ |

### Passos técnicos da plataforma (strangler, sem big-bang) — ver `PLATAFORMA_BASE.md`
0. ✅ Entitlements + gate + launcher.
1. Messaging Gateway (saída) — fachada única de envio.
2. Barramento de entrada — webhook publica evento; `core` é o 1º consumidor (produto não muda).
3. Extrair o módulo `core` para trás do contrato `ZapModule`.
4. Provisionamento billing → entitlement (contratar libera acesso de verdade).
5+. Novos módulos plugam pelo contrato.

---

## 5. Modelo de negócio

- **Login único (SSO):** um cadastro dá acesso a todos os módulos contratados.
- **À la carte:** o cliente contrata 1 ou mais módulos; vê no launcher só o que assinou, com os
  demais como upsell.
- **Cobrança agregada:** 1 assinatura Asaas com valor = soma dos módulos ativos → **1 fatura,
  1 PIX/cartão** (melhor UX para o MEI). Bundles (ex.: *Vendas* = CRM + Campanhas + Cobrança)
  podem ter preço menor que a soma, calculado a partir do catálogo.

---

## 6. O que já está no branch

- `packages/modules/catalog.ts` — catálogo canônico (9 módulos).
- `packages/database` — models `Product`/`Entitlement` + migração + seed/backfill.
- `apps/api` — `lib/moduleGate.ts` (`requireModule`), `routes/entitlements.ts` (`GET /modules`,
  `GET /modules/me`), `modules` no `/auth/me`.
- `apps/web` — launcher `/app` + item "Módulos" no menu.
- Docs: `MODULOS_ARQUITETURA.md`, `PLATAFORMA_BASE.md`, este `projetomodulos.md`.

---

## 7. Próximo passo recomendado

**Passo 1 (Messaging Gateway)** + **Passo 4 (provisionamento billing→entitlement)** destravam a
monetização real; em seguida **Cobrança** como primeiro módulo pago ponta a ponta. Em paralelo,
estabilizar o CI (hoje não roda os testes de verdade — ver anexo de `MODULOS_ARQUITETURA.md`).
