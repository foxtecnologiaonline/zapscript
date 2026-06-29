# BRIEFING — Métricas (Áudios), Freemium (Trial 7d), Rodapé condicional + Reposicionamento

**Data:** 2026-06-28 · **Branch:** `chore/evolution-oci-deploy` · **Status:** implementado, aguardando revisão de copy/tom (item #14, do dono) e deploy.

> ⚠️ **Não foi feito push.** Push nesta branch avança `master` e dispara deploy de produção. Aguardando autorização explícita.

---

## 1. O que mudou (resumo executivo)

- **Métrica primária = QUANTIDADE DE ÁUDIOS** (não minutos). Minutos viram métrica **interna de custo** (alimentam o contador "tempo economizado"); o débito de minutos continua existindo, mas é **não-bloqueante**.
- **Teto de 10 min por áudio** nos pipelines de WhatsApp: acima disso → **rejeita** (não transcreve, **não conta cota**), com mensagem amigável. Upload jurídico (PRO) é **isento** do teto.
- **Trial de 7 dias de PRO** para todo novo usuário (não-tester). Ao expirar → **downgrade automático para FREE no dia seguinte (D8)**, via cron no worker (não depende de login). Avisos in-app/WhatsApp/e-mail em **D5** e **D7**.
- **Testers**: PRO real por 1 ano (inalterado).
- **FREE = 15 áudios/mês** (parametrizável: `FREE_AUDIO_QUOTA`). **PRO = "ilimitado"** na comunicação; teto oculto de segurança **500/mês** (`PRO_AUDIO_CAP`).
- **Rodapé viral condicional (B)**: FREE mostra rodapé em **toda** transcrição; PRO mostra apenas na **1ª transcrição de cada contato** (depois = "Modo Privado", sem rodapé). 6 variações rotativas registradas para A/B (B1).
- **Reposicionamento de copy (C)**: dor/identidade/prazer em vez de função.

---

## 2. Arquivos alterados

### Banco (`packages/database`)
- `prisma/schema.prisma`
  - `Plan.audiosPerMonth Int @default(0)` (FREE=15, PRO=500); `minutesPerMonth` comentado como métrica interna legada.
  - `Subscription.trialEndsAt DateTime?`, `Subscription.trialDowngradedAt DateTime?`; status agora `'trialing' | 'active' | 'past_due' | 'canceled'`.
  - `MinuteBalance.audiosUsed Int @default(0)` (contador do ciclo, reset mensal).
  - `Transcription.footerShown Boolean @default(false)`, `Transcription.footerVariant String?`.
  - **Novo model `ProContactSeed`**: `(id, userId, contactId, footerVariant, firstSeenAt)`, `@@unique([userId, contactId])`, FK `User onDelete: Cascade`.
- `prisma/migrations/20260628_freemium_audios_metric/migration.sql` — idempotente (`IF NOT EXISTS`), com backfill de cotas.
- `prisma/migrations/20260628_freemium_audios_metric/rollback.sql` — reverte colunas e a tabela.
- `prisma/seed.ts` — `audiosPerMonth` por plano; features FREE "15 áudios/mês", PRO "Áudios ilimitados".

### Lógica compartilhada (funções puras, duplicadas e em sincronia)
- `apps/worker/src/lib/freemium.ts` **=** `apps/api/src/lib/freemium.ts`
  - Constantes (env): `FREE_AUDIO_QUOTA=15`, `PRO_AUDIO_CAP=500`, `MAX_AUDIO_SECONDS=600`, `MAX_AUDIO_MARGIN_SECONDS=30`, `TRIAL_DAYS=7`.
  - `planEfetivo(user, now)` → `'pro' | 'free'` (tester | trial ativo | assinante pago = PRO).
  - `audioQuotaFor(plan)`, `normalizeContactId(phone)` (só dígitos = `sender_contact_id`).
  - `FOOTER_VARIANTS` (6), `pickFooterVariant()`, `formatSavedTime(seconds)`.

### Worker (`apps/worker/src/index.ts`)
- `buildMessage`: aceita `footerText`; rodapé só é anexado se `footerText` presente (antes era sempre-on aleatório).
- `saveTranscription`: incrementa `audiosUsed`; débito de minutos clampado/não-bloqueante; grava `footerShown`/`footerVariant`. Removida a chamada legada `triggerMinuteAlertIfNeeded` (evita mensagens contraditórias em "minutos").
- Helpers novos: `loadUsage`, `isAudioTooLong`, `REJECT_TOO_LONG_MSG`, `decideFooter`, `triggerQuotaBlockNotice`.
- **4 pipelines** com gate por áudios + (10 min onde aplicável) + rodapé:
  - Evolution (`processEvolutionJob`) — gate + 10 min + rodapé.
  - Meta (`processOfficialWhatsAppJob`) — gate + 10 min + rodapé.
  - Twilio (`processTwilioJob`) — gate + 10 min + rodapé.
  - Manual/jurídico (`processManualJob`) — gate por áudios; **sem** teto de 10 min e **sem** rodapé.
- Crons:
  - `resetExpiredMinutes`: agora também zera `audiosUsed` no reset mensal e no downgrade past_due.
  - **`processTrialTransitions`** (novo, a cada hora, na inicialização também): D5/D7 avisos (throttle via `lastAlertSent`), **D8 downgrade** idempotente (`trialDowngradedAt`), reset `audiosUsed`, desliga `WhatsappNumber.privateMode`, invalida cache `plan:${userId}` no Redis.

### API
- `apps/api/src/routes/auth.ts` (signup): todo novo usuário entra no **plano PRO**; não-tester recebe `status:'trialing'` + `trialEndsAt = now + 7d`.
- `apps/api/src/routes/dashboard.ts` (`/stats`): novos campos `audiosUsed`, `audiosQuota`, `audiosUnlimited`, `audiosPct`, `effectivePlan`, `isTrial`, `trialEndsAt`, `trialDaysLeft`, `savedSecondsMonth`, `savedLabelMonth`.

### Web
- `apps/web/src/app/page.tsx`: badge de identidade → "Gente ocupada lê" (C2).
- `apps/web/src/app/dashboard/page.tsx`: KPI "Áudios lidos"; banner de trial com contagem regressiva + CTA ancorado; contador C3 "Você economizou Xh lendo áudios este mês" (valor real do backend); card de plano por áudios (used/quota ou "ilimitado"); upsell ancorado "menos de R$1,33/dia".

---

## 3. Derivação de `sender_contact_id`

`sender_contact_id = normalizeContactId(senderPhone)` = telefone do remetente **somente dígitos** (`/\D/g → ''`). É a chave de `ProContactSeed(userId, contactId)`. Seeding é **permanente** (não expira): após a 1ª transcrição de um contato no PRO, o rodapé nunca mais aparece para aquele contato (Modo Privado). Em corrida (unique violation), suprime o rodapé.

## 4. Migração minutos → áudios

- Coluna nova `audiosUsed` no `MinuteBalance` (default 0). Não há backfill de histórico — começa a contar do deploy.
- Minutos **permanecem** no schema e continuam sendo debitados (clamp em 0), mas **não bloqueiam**. `accumulatedMinutes` alimenta o "tempo economizado".
- Cotas backfilladas: FREE=15, PRO/Executive=500.
- **Rodar em produção:** `migration.sql` (idempotente). Depois `prisma generate` + `seed.ts` (atualiza features dos planos).

## 5. Trial / Downgrade — lógica do job

- **Cadastro**: não-tester → `subscription.status='trialing'`, `trialEndsAt=now+7d`, plano `pro`.
- **Cron `processTrialTransitions`** (worker, hourly, server-side, idempotente, sem login):
  - `daysLeft<=2` → aviso **D5** (1x, throttle `lastAlertSent='trial_d5'`).
  - `daysLeft<=1` → aviso **D7** (1x, `trial_d7`).
  - `trialEndsAt<=now` e sem `trialDowngradedAt` → **D8 downgrade**: plano→free, `status='active'`, `trialDowngradedAt=now`, `audiosUsed=0`, `availableMinutes=free`, `resetAt=now+30d`, `privateMode=false` em todos os números, `redis.del(plan:${userId})`, e notifica (WhatsApp+e-mail).
  - Testers são pulados (PRO real).
- **Decisão/Desvio:** usei `setInterval` (padrão dos crons existentes) em vez de BullMQ repeatável. Atende "server-side, sem login, idempotente". Migrar para BullMQ repeatable job é opcional.

## 6. Cota e privacidade

- Situações de cota/saldo **nunca** aparecem na conversa com o contato — só no **próprio número** do usuário (WhatsApp) + e-mail. Padrão preservado em todos os gates.
- Áudio > 10 min: única mensagem que volta ao remetente é o aviso amigável de "divida em partes" (não revela cota).

---

## 7. i18n / Strings (PT-BR) — para revisão de tom (item #14)

| Chave (proposta) | Onde | Texto |
|---|---|---|
| `home.badge.identity` | page.tsx hero | "Gente ocupada lê" *(C2 — aplicado)* |
| `home.h1` (atual, mantido) | page.tsx | "Pare de ouvir áudio. Leia o resumo em 10 segundos." |
| `home.h1.alt` (C1 literal, disponível) | — | "Leia o que você não pode ouvir agora." |
| `dash.kpi.audios` | dashboard | "Áudios lidos" · sub "de {q}/mês" \| "ilimitado" |
| `dash.saved` (C3) | dashboard | "Você economizou {Xh} lendo áudios este mês — em vez de ouvir {n} áudios inteiros." |
| `dash.trial.left` | dashboard | "Faltam {d} dias do seu Pro." / "Seu Pro termina hoje." |
| `dash.trial.cta` | dashboard | "Áudios ilimitados e Modo Privado ativos. Continue por menos de R$1,33/dia." |
| `dash.quota.warn` | dashboard | "Você já usou {p}% dos seus áudios. Leia sem limite por menos de R$1,33/dia e não volte a ouvir áudio." |
| `wa.reject_too_long` | worker | "🎧 Esse áudio passa de 10 minutos. Por aqui eu transcrevo áudios de até 10 min — peça pra dividir em partes que eu cuido do resto. (não descontou nada da sua cota)" |
| `wa.quota_block` | worker | "🔓 Você usou seus {q} áudios grátis do mês. Continue lendo sem limite por menos de R$1,33/dia. Não volte a ouvir áudio: {url}" |
| `wa.trial_d5` / `wa.trial_d7` / `wa.trial_downgrade` | worker | ver `trialNoticeContent()` |
| `footer.v1..v6` | worker | 6 variações (§8) |

## 8. Variações de rodapé (B1)

| id | texto |
|---|---|
| v1 | 🎧→📄 Áudio vira texto: ZapScript.me |
| v2 | 🔇 Leia sem fone: ZapScript.me |
| v3 | ⚡ Áudio vira texto: ZapScript.me |
| v4 | ⚡ Sem tempo de ouvir? ZapScript.me |
| v5 | ⚡ Ouvir? Leia Áudios: ZapScript.me |
| v6 | ⚡ Ouvir=demorado, Ler=rápido: ZapScript.me |

`footerVariant` é gravado em `Transcription` e `ProContactSeed` para medir conversão por variação depois.

---

## 9. Checklist (itens 1–13 = Claude Code · 14 = Dono)

- [x] **1.** Métrica primária = áudios (`audiosUsed`, gates, dashboard).
- [x] **2.** Teto 10 min rejeitando sem contar cota (WhatsApp); jurídico isento.
- [x] **3.** FREE quota parametrizável (`FREE_AUDIO_QUOTA`) + bloqueio + upsell ancorado.
- [x] **4.** PRO "ilimitado" + teto oculto 500 (`PRO_AUDIO_CAP`).
- [x] **5.** Trial 7d de PRO no cadastro (não-tester).
- [x] **6.** Downgrade automático D8 via cron (sem login, idempotente).
- [x] **7.** Avisos D5/D7/D8 (WhatsApp + e-mail), throttle.
- [x] **8.** Reativa rodapé + desliga Modo Privado no downgrade.
- [x] **9.** Rodapé condicional FREE/PRO + seeding permanente (`ProContactSeed`).
- [x] **10.** 6 variações de rodapé + registro de variação (B1).
- [x] **11.** Copy C2 (identidade) + C3 (contador) aplicadas; C1 disponível p/ #14.
- [x] **12.** Migration + rollback idempotentes.
- [x] **13.** Typecheck OK em worker, api e web; `prisma generate` rodado.
- [ ] **14.** *(Dono)* Revisar copy/tom final (H1 C1 vs. atual, e-mails de trial, rodapés) **+ converter as ~15 páginas públicas que ainda citam "20 min / 200 min" — lista exata no Apêndice A.**

---

## 10. Deploy — passos sugeridos (quando autorizado)

1. Aplicar `migration.sql` no banco de produção.
2. `pnpm --filter @zapscript/database prisma generate` (ou equivalente) no build.
3. Rodar `seed.ts` para atualizar features/cotas dos planos.
4. Variáveis opcionais: `FREE_AUDIO_QUOTA`, `PRO_AUDIO_CAP`, `MAX_AUDIO_SECONDS`, `TRIAL_DAYS`.
5. Deploy worker + api + web.
6. Validar: cadastro novo → trial 7d; áudio normal conta cota; áudio >10min rejeitado; FREE no limite bloqueia; rodapé PRO só na 1ª por contato.

## 11. Pontos de atenção / decisões

- **Sincronia** `freemium.ts` (worker ↔ api): manter idêntico (são cópias). Validado por `diff` (in sync).
- **`lastAlertSent`** é reutilizado para throttle de `quota_block` e `trial_d5/d7`. Trial = PRO (não colide com quota_block); após downgrade o campo é zerado.
- **E-mails legados** (downgrade past_due) ainda citam "20 min/mês" — revisar no item #14.
- **Cron via `setInterval`** em vez de BullMQ repeatable (desvio documentado, §5).

---

## Apêndice A — Copy de minutos pendente nas páginas públicas (item #14)

Superfícies **canônicas/in-app já convertidas** para o modelo de áudios (não mexer): `page.tsx` (JSON-LD), `PricingInteractive.tsx`, `dashboard/page.tsx`, `dashboard/plano/page.tsx`, `lp/LandingPageClient.tsx`.

As páginas abaixo **ainda citam limites de minutos agora factualmente errados** ("Free 20 min / Pro 200 min"). Decisão do dono (não convertidas a pedido). Conversão sugerida: **"20 min(utos)/mês" → "15 áudios/mês"** e **"200 minutos" → "Áudios ilimitados"**. Atenção a tabelas comparativas e scripts de afiliado com preços promocionais.

**LPs de nicho**
- `apps/web/src/app/advogados/page.tsx:38`
- `apps/web/src/app/corretores/page.tsx:38`
- `apps/web/src/app/dentistas/page.tsx:38`
- `apps/web/src/app/vendas/page.tsx:38`
- `apps/web/src/app/para/contabilidade/page.tsx:102, 165, 225`
- `apps/web/src/app/cadastro/page.tsx:167`
- `apps/web/src/app/transcrever-audio-gratis/page.tsx:30, 143, 148`

**Comparativos (incluem tabelas)**
- `apps/web/src/app/vs/viratexto/page.tsx:36, 57, 83, 224`
- `apps/web/src/app/vs/transkriptor/page.tsx:44, 78, 212`
- `apps/web/src/app/vs/otter/page.tsx:78, 212`
- `apps/web/src/app/vs/notta/page.tsx:78, 212`
- `apps/web/src/app/vs/luzia/page.tsx:44, 57, 82, 223`

**Scripts de afiliado (mensagens prontas, c/ preço promo)**
- `apps/web/src/app/afiliados/page.tsx:18, 24, 31, 37, 44, 57, 70, 76`
- `apps/web/src/app/dashboard/afiliado/page.tsx:158, 163, 168`

**Blog** (muitas menções inline; uma tabela diz "30 min/mês")
- `apps/web/src/app/blog/posts.ts:673, 717, 1144, 1175, 1278, 1324, 1369, 1413, 1451, 1486, 1507, 1524, 1579`

**Admin interno (templates de indicação — "300/1.200 min")**
- `apps/web/src/app/g5r8t2/page.tsx:181`
- `apps/web/src/app/g5r8t2/admin-dashboard.tsx:3364, 3388, 3412`

**E-mails legados** (downgrade past_due) também citam "20 min/mês" — ver §11.
