# RECON.md — Reconhecimento (Fase 0 do BRIEFING.md)

**Data:** 2026-07-06 · **Branch base:** `chore/evolution-oci-deploy` (⚠️ = master; push dispara deploy)

## Stack
- **Monorepo pnpm**: `apps/web` (Next.js 14 App Router, TS + Tailwind), `apps/api` (Fastify), `apps/worker` (BullMQ), `packages/database` (Prisma + Supabase/Postgres). Web hospedada na Vercel.
- **Pipeline de IA** (`apps/worker/src/index.ts`): Whisper (Groq→OpenAI, com anti-alucinação) → resumo via Claude (Haiku/Sonnet escalonado por duração) com fallback gpt-4o-mini.

## Onde vive o conteúdo das páginas por profissão
- **Arquivos estáticos por rota**, não CMS: `/corretores`, `/advogados`, `/vendas`, `/dentistas` (planas) + `/para/contabilidade` (padrão diferente). Cada `page.tsx` tem `metadata` (title/description/OG) e um array de dados local (features, `faqs`). **Não há template dinâmico único** — cada página é um arquivo próprio.

## Blog / CMS
- **Já existe**: `/blog` + `/blog/[slug]` lendo de `apps/web/src/app/blog/posts.ts` (posts em TS, não MDX/CMS headless). JSON-LD por post presente.

## Páginas de comparação (`/vs`)
- **Já existem e nomeiam concorrentes**: `/vs/viratexto`, `/vs/luzia`, `/vs/otter`, `/vs/notta`, `/vs/transkriptor` (todas com JSON-LD). ⚠️ Ou seja, a trava do briefing "não nomear concorrente sem aval" já foi ultrapassada em produção.

## Analytics / instrumentação
- **Maduro** (`lib/analytics.ts` + `components/Analytics.tsx`): GA4 + Google Ads + Meta Pixel (gated por env) **e** analytics first-party (`/api/track`) que alimenta o painel admin. Funil `signup`/`activation`/`subscribe` (`track()`), pageview SPA, clique em CTA via `[data-cta]`, e **infra de A/B pronta** (`pickVariant`). Falta apenas o evento `churn`.

## SEO técnico
- `robots.txt` (público, com allow-list de bots de IA e bloqueio de scrapers) e `sitemap.ts` nativo (rotas estáticas + posts) — **ambos existem e maduros**.
- **Schema.org na home**: `SoftwareApplication` + `FAQPage` com ofertas Free/Pro — **feito**. Nas páginas de profissão: **JÁ emitem `FAQPage` + `BreadcrumbList` JSON-LD** — o schema vive no client compartilhado `lp/LandingPageClient.tsx` (linhas ~167-192), que todas as LPs planas usam via `variant.faqs`; `/para/contabilidade` tem o próprio JSON-LD. (Correção: o grep inicial olhou o arquivo da página, não o client — daí a impressão de que faltava.)

## Bloqueios técnicos relevantes
1. **URLs de profissão são planas e já indexadas** (sitemap desde 2026-06). Migrar p/ `/para/[profissao]` (Fase 2.4) exige 301 e carrega risco de SEO — decisão de custo/benefício, não óbvia.
2. **`generateBullets()` não recebe perfil/profissão** — tom por vertical (Fase 1.2) exige propagar o perfil do usuário pelo job até o prompt.
3. **Pendências/ação já são extraídas** (sentinels `⚠️`/`::P::`) — Fase 1.1 é *evoluir* o que existe (tipo+data estruturados + botão), não criar do zero.
