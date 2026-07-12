# Checkpoint Dia 17/30 — Plano de Marketing ZapScript

> Diagnóstico em 2026-07-12. Referência: `PLANO-MARKETING-30D.md` (consolidado 2026-06-25,
> meta 100 cadastros / 30 pagantes / ~R$1.197 MRR / CAC-teto R$16 até 2026-07-25).
> Este documento **não substitui o plano** — é o checkpoint de execução que faltava.

## Diagnóstico: o que já está construído (não refazer)

O histórico de commits (18/06 → 06/07) mostra um sprint de growth denso, já rodando:
funil (trial 7d c/ cartão, âncora R$1,33/dia, promo Fundador R$19,90), loop viral
(rodapé da transcrição + `/i/CODE` de atribuição invisível, 90 dias), aquisição orgânica
(23 posts de blog, 4 páginas `/vs/concorrente`, LPs por nicho: corretores/advogados/vendas/
contabilidade/dentistas), lifecycle e-mails, kit de afiliados, contramedidas de ativação/
funil, e um painel de **inteligência de crescimento com 5 módulos reais** (cohorts,
LTV/CAC/payback, K-factor, MRR movement) em `apps/web/src/app/g5r8t2/admin-dashboard.tsx`.

**Isso é volume de construção real, não vaidade** — mas construir não é o mesmo que medir.
De 07/07 a 11/07 não há nenhum commit de growth (o último foi 06/07); o produto pediu
atenção em segurança/privacidade nesse intervalo. Ponto cego natural: ninguém checou os
números do próprio painel que foi construído.

## O que não dá para ver a partir desta sessão (premissa declarada)

Não tenho acesso a GA4, Google Ads/Meta Ads Manager, nem ao banco de produção aqui — não
vou inventar número de cadastro/pagante. Os 3 achados abaixo vêm de **leitura de código**,
não de dado ao vivo, e são 100% verificáveis por você em minutos.

## 3 achados críticos (framework → risco → onde olhar)

**1) Instrumentação não confirmada — Google Ads pode estar otimizando às cegas.**
`.env.example` mostra `NEXT_PUBLIC_GADS_SIGNUP/ACTIVATE/SUBSCRIBE` **em branco** por padrão.
O próprio checklist da Semana 1 do plano já previa isso ("confirmar rastreamento ligado")
— mas não há evidência de que foi confirmado em produção. Sem essas labels apontando pra
ações de conversão reais, 17 dias de Google Search rodaram sem o pixel aprender o que é
"virou pagante" (Traction/Bullseye exige *feedback loop* por canal — sem isso não dá pra
saber se o canal funciona, só se ele gasta).
→ *Ação:* confirmar em Vercel (env de produção) que as 3 labels têm valor real, e no
Google Ads que as conversões estão registrando.

**2) Unit economics cego por desenho — CAC/LTV:CAC/payback saem `—` até input manual.**
O próprio painel admin avisa: *"CAC, LTV:CAC e payback dependem do investimento em mídia
(não rastreado no banco) — informe os custos no painel 💰 Receita."* Regra do domínio
"Aquisição de clientes": LTV:CAC ≥ 3:1 e payback < 12m são o **gate** antes de qualquer
aumento de budget (Running Lean, Maurya — valida economics antes de escalar). Hoje esse
gate está null, não reprovado — mas null não autoriza escalar.
→ *Ação:* lançar o gasto real de mídia (dia 0–17) no painel 💰 Receita agora.

**3) Canibalização de SEO já diagnosticada, nunca corrigida.**
`marketing/SEO-20-KEYWORDS-E-ADS-CONCORRENTES.md` já mapeou: 3 posts duplicados cada
para advogados, corretores e vendas (9 posts competindo consigo mesmos pela mesma
keyword cluster, diluindo autoridade — Google raramente rankeia os dois). A recomendação
de consolidar via 301 está escrita desde então e **nunca foi executada** (confirmado: zero
commit de consolidação no histórico). Custo de correção ≈ zero; custo de não corrigir é
ranking perdido todo dia que passa.
→ *Ação:* decisão sua — ver seção "menor ação" abaixo.

## Métrica-alvo (herdada do plano, travada — não mudo o alvo, só o checkpoint)

Meta dia 30: **100 cadastros · 30 pagantes · CAC ≤ R$16 · LTV:CAC ≥ 3:1 · payback < 12m.**

Interpolando a própria curva semanal do plano (dia14≈50 cadastros/10 pagantes →
dia21≈75/21) para hoje (dia17, 3 dias dentro da semana 3):
**≈ 58–63 cadastros, ≈ 13–17 pagantes esperados.**
Isso já é o lado otimista — o próprio *reality-check* do plano admite banda mais frouxa
no mês inteiro (60–100 cadastros, 12–25 pagantes). Piso honesto de hoje: **≥10–12
pagantes acumulados** já está dentro do esperado; abaixo disso, atenção.

## Frameworks que decidem esta rodada

- **Running Lean / Lean Startup (Maurya)** — valida unit economics antes de aumentar spend.
- **"Don't scale" (Paul Graham)** — resistir a abrir canal novo (TikTok, LinkedIn Ads,
  nicho novo) antes de saturar o que já converte.
- **AARRR (McClure)** — os 3 achados mapeiam, respectivamente, em Aquisição (sinal de
  conversão pro Ads), Receita (unit economics) e Aquisição orgânica/SEO.
- **Loop vs. funil (Weinberg & Mares / K-factor)** — o painel já calcula K-factor; se
  o loop viral (rodapé + `/i/CODE`) estiver perto de K=1, isso muda a prioridade de mês 2
  de "comprar mais tráfego" para "azeitar o loop que já é grátis".

## Menor ação que já gera sinal (próximas 48h)

**P0 — checagem pura, zero código, você faz direto:**
1. Confirmar labels `GADS_SIGNUP/ACTIVATE/SUBSCRIBE` preenchidas em produção (Vercel) +
   conversões aparecendo no Google Ads.
2. Lançar o gasto real de mídia (dia 0–17) no painel 💰 Receita do admin.
3. Puxar do admin: cadastros e pagantes acumulados, comparar com a faixa ≈58–63 / ≈13–17
   acima. Checar K-factor no módulo de Alavancas.

**P1 — decisão pendente, não executo sem sua confirmação (mexe em SEO de site no ar):**
4. Consolidar os 9 posts duplicados (3× advogados/corretores/vendas) em 3, com 301 dos
   mais fracos para o mais forte — já diagnosticado, nunca feito. Me avisa e eu executo.

**O que NÃO fazer ainda:**
- Não subir budget de mídia.
- Não abrir canal novo.
- Não criar mais conteúdo para advogados/corretores/vendas (piora a canibalização do
  achado #3 em vez de ajudar).
Trava: só depois que P0.1–P0.3 confirmarem que o funil converte dentro do CAC-teto.

## Critério de sucesso / corte

**Dia 21 (fim da semana 3):**
- ✅ Sucesso: ≥18 pagantes acumulados **e** CAC real ≤ R$16 → manter o plano como está,
  semana 4 foca em fechar a meta.
- ✂️ Corte: <12 pagantes **ou** CAC > R$16 (com dado real, não `—`) → pausar mídia paga,
  voltar 100% para outreach + SEO orgânico (custo marginal ≈0) no resto do mês, e
  investigar o funil etapa a etapa (visita→cadastro→conexão→1ª transcrição→pagamento)
  antes de gastar mais 1 real.

**Dia 30 (fechamento):**
- ✅ Sucesso: LTV:CAC ≥ 3:1 e payback < 12m confirmados com dado real → mês 2 recebe
  aumento de budget (proponho 1,5×, faseado em 2 semanas) só no canal com melhor CAC.
- ✂️ Corte: qualquer um dos dois não bate → budget de mês 2 fica flat ou cai, e o esforço
  vai para ativação/retenção, não para mais aquisição (regra-mãe: só escalar aquisição
  sobre retenção já estancada).

## Próximo passo objetivo

Rode P0.1–P0.3 (15 min, sem código) e me responda com os 3 números reais (cadastros,
pagantes, CAC). A partir deles eu recalculo a decisão de dia 21 com dado, não estimativa
— e te digo se P1 (consolidação de SEO) entra esta semana.
