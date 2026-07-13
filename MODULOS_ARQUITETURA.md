# ZapScript Suite — Arquitetura de Módulos (login único + acesso por módulo)

> **Objetivo:** transformar o ZapScript de **produto único** (transcrição) em uma **suíte de
> módulos** sobre a mesma infraestrutura. O usuário faz **um login** e **contrata 1 ou mais
> módulos à la carte**; a interface mostra **apenas os módulos contratados** e oferece os demais
> como upsell. Nenhum módulo novo constrói infra nova — todos reusam mensageria, transcrição,
> billing, auth e observabilidade já validados.

Status deste documento: **proposta de arquitetura (Fase de planejamento)**. Data: 2026-07-07.
Branch: `claude/zapscript-modules-nv95eb`.

---

## 1. Portfólio de módulos

| Key | Produto | JTBD (dor) | Reuso de infra | Fase |
|-----|---------|-----------|----------------|------|
| `core` | **ZapScript** (Transcrição) | "Não tenho tempo de ouvir áudio no WhatsApp" | — (é a base) | **GA** |
| `atende` | **ZapScript Atende** | "Preciso responder cliente 24/7 sem contratar gente" | Mensageria + IA | **Beta / em construção** |
| `cobranca` | **ZapScript Cobrança** | Inadimplência do MEI: cobrar venceu/vence hoje/2ª via | **100%** mensageria | **P1 — próximo** |
| `campanhas` | **ZapScript Campanhas** | Disparo em massa *compliant* (janela Meta dez/2025) | API oficial WhatsApp | **P1 — janela urgente** |
| `crm` | **ZapScript CRM** | Gap entre "responder" e "vender" no WhatsApp (funil) | Conversas + mensageria | **P2 — cross-sell c/ Atende** |
| `atende-qualidade` | **Atende Qualidade** | "O bot tá funcionando?" (tempo resposta, sentimento, conversão) | Dados do Atende | **P2** (depende de `atende`) |
| `legenda` | **ZapScript Legendas** | Legenda automática de Reels/Stories (ICP novo: criador) | Motor Whisper | **P2 — baixo risco técnico** |
| `vendas` | **ZapScript Vendas** | Vendedor grava visita → transcreve/resume → nota no CRM | Motor Ata/Whisper | **P3** (sinergia c/ `crm`) |
| `multicanal` | **ZapScript Multicanal** | Todos os módulos replicados noutras plataformas (Instagram, Facebook, Telegram) | Motor `core`/`atende` | **P3 — discovery** (validar com 5 antes) |

> `atende-qualidade` **depende** de `atende`. `vendas` tem sinergia (não dependência
> dura) com `crm`. Estes vínculos vivem no registry (`dependsOn`) e são aplicados no checkout e no gate.

A fonte única da verdade deste catálogo é **`packages/modules/catalog.ts`** (criado junto com este
documento). Web, API e billing consomem o **mesmo** arquivo — nunca duplicar preço/estado/nome.

---

## 2. Decisão de arquitetura: **monólito modular**, não microserviços

Contexto: time enxuto, infra compartilhada (Evolution/WhatsApp oficial, Redis/BullMQ, Prisma,
Supabase Auth, Asaas), deploy único no Render. Cada "módulo" é um **bounded context de features**
sobre serviços compartilhados — **não** um serviço com deploy próprio.

- **API** (`apps/api`): rotas por módulo em `src/routes/modules/<key>/*` + serviços compartilhados
  em `src/services/*` (mensageria, transcrição, IA). Gate por módulo no `preHandler`.
- **Worker** (`apps/worker`): filas nomeadas por módulo (`queue:cobranca`, `queue:campanhas`…),
  reusando o mesmo Redis/BullMQ e os mesmos serviços de envio/transcrição.
- **Web** (`apps/web`): um **app shell** único (`/app`) com launcher de módulos; cada módulo é uma
  rota `/app/<key>/*` renderizada só se houver entitlement.

Por quê: menor custo operacional, uma superfície de segurança, transações locais, reaproveitamento
direto. Extrair um módulo para serviço próprio (ex.: `legenda` se virar produto de volume alto e
CPU-bound de vídeo) é feito depois via *strangler fig* — a fronteira de módulo já deixa isso barato.

---

## 3. Modelo de domínio: **Entitlements** ao lado dos tiers

O `Plan` atual (free/pro/ultra) descreve **tiers de cota do módulo `core`** (nº de áudios, nº de
números). Ele **continua existindo** para o `core`. A novidade é a camada de **titularidade de
módulo** (quem tem acesso a quê), independente de tier.

```
User ─┬─ Subscription (1)      → contêiner de cobrança Asaas (customerId, subscriptionId, método)
      ├─ MinuteBalance (1)     → cota do core (inalterado)
      └─ Entitlement (N)       → 1 por módulo contratado  ← NOVO
                                   (userId, productKey, status, source, currentPeriodEnd)
Product (catálogo, N)          → espelha packages/modules/catalog.ts  ← NOVO (seed)
```

### 3.1 Novos modelos Prisma (proposta)

```prisma
model Product {
  id           String   @id @default(cuid())
  key          String   @unique          // 'core' | 'cobranca' | ...  (== catalog.ts)
  name         String
  status       String   @default("planned") // 'ga' | 'beta' | 'planned' | 'discovery'
  priceMonthly Float    @default(0)
  priceYearly  Float    @default(0)
  dependsOn    String[] @default([])      // ['atende'] etc.
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  entitlements Entitlement[]
}

model Entitlement {
  id               String    @id @default(cuid())
  userId           String
  productKey       String                          // FK lógica p/ Product.key
  status           String    @default("active")    // 'active'|'trialing'|'past_due'|'canceled'
  source           String    @default("paid")      // 'paid'|'trial'|'comp'|'bundle'|'affiliate'
  currentPeriodEnd DateTime?
  canceledAt       DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  product          Product   @relation(fields: [productKey], references: [key])

  @@unique([userId, productKey])
  @@index([userId, status])
}
```

`Entitlement` é **billing-agnóstico**: é a verdade sobre acesso, seja a cobrança agregada ou por
módulo. Isso desacopla "o que o usuário pode usar" de "como pagamos por isso".

### 3.2 Migração de dados (backfill, zero-downtime, expand/contract)

1. **Expand:** criar tabelas `Product`/`Entitlement` (aditivo, não quebra nada).
2. **Seed** `Product` a partir de `catalog.ts`.
3. **Backfill:** todo usuário ativo ganha `Entitlement(core, active)`. Quem tem `plan=pro`
   mantém o tier no `Subscription/Plan` (inalterado) — o entitlement só diz "tem o módulo core".
4. **Adoção gradual:** rotas passam de `requirePlan()` para `requireModule()` módulo a módulo.
5. **Contract:** só depois de tudo migrado, `requirePlan` fica restrito ao tier interno do `core`.

---

## 4. Controle de acesso (API + UI)

### 4.1 API — `requireModule()` espelhando `planGate.ts`

Novo `apps/api/src/lib/moduleGate.ts` com o **mesmo padrão** do `planGate` (cache Redis 60s,
fail-open só em leitura, invalidação no webhook):

```ts
// preHandler das rotas de um módulo:
app.post('/cobranca/lembrete', {
  preHandler: [app.authenticate, requireModule('cobranca')],
}, handler);
```

`requireModule(key)` → lê `getEntitlements(userId)` (cache) → se `key` ∉ ativos, responde **402
Payment Required** (`{ error, moduleRequired, upsellUrl }`) — semântica melhor que 403 para
"existe, mas você não contratou". Dependências (`dependsOn`) são checadas junto.

### 4.2 `/auth/me` passa a devolver `modules`

Além de `subscription`/`plan`/`balance`, o `/me` retorna o mapa de titularidade, que é o que o
front usa para montar o launcher e as rotas:

```jsonc
"modules": {
  "core":     { "status": "active", "tier": "pro" },
  "cobranca": { "status": "active" }
  // não contratados simplesmente não aparecem
}
```

### 4.3 UI — app shell com launcher

- **`/app`** (novo home logado): grid de cards. Card do módulo contratado → abre `/app/<key>`;
  card não contratado → CTA de contratação (usa o mesmo catálogo/preço).
- **Nav lateral** deixa de ser lista fixa: é **derivada de `me.modules`** (some o hardcode do
  `dashboard/layout.tsx`). O `core` e "Plano/Config/Afiliados" continuam globais.
- **Guarda de rota:** cada `/app/<key>/layout.tsx` verifica o entitlement e redireciona para o
  card de upsell se ausente (defesa em profundidade — o gate real é na API).
- O `/dashboard` atual vira o módulo `core` (`/app/core` ou alias), sem quebrar links existentes.

---

## 5. Billing (Asaas) — decisão em aberto

O `Entitlement` funciona com qualquer das opções abaixo. A escolha é de **negócio (UX × esforço)**:

| Opção | Como | Prós | Contras |
|-------|------|------|---------|
| **A. Assinatura única agregada** *(recomendada)* | 1 Subscription Asaas cujo valor = **Σ preços dos módulos ativos**; add/remove módulo = atualizar valor + proração | 1 fatura, 1 cobrança PIX/cartão (melhor p/ MEI); reusa 100% o fluxo atual | lógica de proração ao mudar composição |
| **B. Assinatura por módulo** | 1 Subscription Asaas por módulo | cancelamento isolado trivial | N faturas/cobranças, PIX repetido — UX ruim p/ MEI |
| **C. Bundles fixos** | pacotes pré-montados (ex.: "Vendas" = crm+campanhas+cobranca) | simples de precificar/comunicar | menos "à la carte", combinatória rígida |

**Recomendação: A** (assinatura única agregada) com desconto de bundle aplicado no cálculo do
valor — melhor UX de pagamento para o MEI e menor divergência do código de billing atual. `crm` +
`campanhas` + `cobranca` podem ter um preço de bundle < soma, calculado a partir do `catalog.ts`.

> Esta é a única decisão que trava a Fase 1 (schema de billing + integração Asaas). Ver pergunta ao
> final da entrega.

---

## 6. Estrutura de código (onde cada coisa mora)

```
packages/
  modules/                 ← NOVO: fonte única da verdade do catálogo
    catalog.ts             ← keys, nomes, JTBD, preços, status, dependsOn, ícones
    package.json
  database/                ← + models Product/Entitlement + migration + seed de Product

apps/api/src/
  lib/moduleGate.ts        ← NOVO: requireModule() + getEntitlements() (cache)
  routes/modules/
    cobranca/*.ts          ← rotas do módulo (uma pasta por módulo)
    campanhas/*.ts
  routes/entitlements.ts   ← GET /modules (catálogo público) + estado do usuário
  services/*               ← compartilhado (mensageria, transcrição, IA) — reuso, não duplicar

apps/worker/src/
  modules/<key>/*          ← processadores de fila por módulo (queue:<key>)

apps/web/src/app/
  app/                     ← app shell + launcher
    page.tsx               ← grid de módulos (contratados + upsell)
    <key>/                 ← UI de cada módulo, guardada por entitlement
```

---

## 7. Roadmap por fases (ordem = valor × urgência × reuso)

- **Fase 0 — Fundação (esta entrega):** `catalog.ts` (registry) + este documento. Aditivo, zero risco.
- **Fase 1 — Plataforma de entitlements:** models Prisma + migração + backfill `core` + `moduleGate`
  + `modules` no `/me` + app shell/launcher + billing (após decisão §5). *Sem novo módulo ainda —
  só a "plataforma de módulos".*
- **Fase 2 — `cobranca`:** primeiro módulo pago novo (reusa 100% mensageria; dor #1 do MEI). Valida a
  plataforma ponta a ponta com o menor esforço técnico.
- **Fase 3 — `campanhas`:** aproveitar a janela Meta (dez/2025) — usuários órfãos de bots não
  autorizados precisam de alternativa compliant **agora**.
- **Fase 4 — `crm` + `atende-qualidade`:** cross-sell com Atende; fecha o ciclo "responder → vender →
  medir".
- **Fase 5 — `legenda` / `vendas`:** ICP novo e sinergia comercial; baixo risco técnico
  (só nova interface sobre motores existentes).
- **Fase 6 — `multicanal`:** discovery — validar com 5 conversas antes de investir (mais especulativo).

---

## 8. Riscos & cuidados

- **Não vazar módulos não contratados** em respostas de API/menus (mesma disciplina já aplicada em
  "não vazar saldo/cota na conversa").
- **Entitlement é a fonte de acesso**, nunca o front. UI é conveniência; o gate real é server-side.
- **Suíte de testes hoje está vermelha** (25/84 falhando mesmo com env de CI; `pino-pretty` não
  declarado derruba `buildApp` em teste local — ver §Anexo). Estabilizar CI **antes** de crescer a
  base de código, senão regressões passam batido. Corrigível junto com a Fase 1.
- **Coesão de preço:** todo preço vem do `catalog.ts`. Nenhum hardcode em rota/checkout/landing.

---

## Anexo — Achados de auditoria (evidência real, 2026-07-07)

Levantados ao inspecionar o repositório antes de projetar (Node 22 / pnpm 10):

- ✅ **Typecheck limpo**: `api`, `worker` e `web` passam `tsc --noEmit`.
- ❌ **Testes vermelhos**: `apps/api` → 25/84 testes falham (5/8 suites) mesmo com o bloco de env do
  CI. Sem env de produção, 44 falham porque **`pino-pretty` é usado em `lib/logger.ts` mas não é
  dependência declarada** → `buildApp()` estoura em teste local.
- ⚠️ **CI não roda os testes de verdade**: `ci.yml` chama `pnpm --filter api test -- --passWithNoTests`
  — o `--passWithNoTests` é interpretado pelo jest como *padrão de path* ("No tests found") e o step
  ainda tem `continue-on-error: true`. Resultado: falhas de teste **nunca** barram o merge.
- ⚠️ **`test.yml` provavelmente nunca roda no branch padrão**: dispara em `main/develop`, mas o branch
  padrão é `master`; e usa `npm ci`/`npm run build --workspaces` num monorepo **pnpm** (lockfile
  divergente).
- ➡️ Recomendação: declarar `pino-pretty` como dep (ou trocar transport por guarda de ambiente),
  corrigir a invocação do jest, e alinhar os gatilhos/gerenciador do CI — **antes** de escalar módulos.
