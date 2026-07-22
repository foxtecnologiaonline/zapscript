# Plano de Marketing — 30 dias / 4 semanas — ZapScript

> Consolidado em 2026-06-25. Base estratégica: plano de lançamento de 2026-06-15
> (consultor-marketing). Já incorpora o lote de growth do commit `4c232f3`
> (rodapé viral, `/transcrever-audio-gratis`, +3 posts SEO, paywall por valor,
> indicação no pós-aha).

## Metas (30 dias)
- **100 cadastros** · **30 assinantes Pro** · **~R$ 1.197 de MRR**
- **Budget:** R$ 500/mês (R$ 350 Google Search + R$ 150 Meta)
- **CAC-alvo:** ≤ R$ 16 por pagante
- **Foco de nicho:** corretores de imóveis (LP `/corretores` já existe)
- **Oferta de lançamento:** "Fundador" — 1º mês Pro R$ 18,50

### Reality-check
30% cadastro→pago é agressivo p/ self-serve frio (normal 2–5% frio, 15–25% trial
quente). Viável porque ~70–80% dos cadastros virão de outreach manual quente;
a mídia paga acelera e ensina o pixel. Faixa realista: 60–100 cadastros, 12–25
pagantes (mirar 30).

---

## Semana 1 — Fundação e primeiros cadastros
**Objetivo: instrumentar tudo e começar o outreach manual.**
- [ ] Confirmar rastreamento ligado: Pixel Meta + labels Google Ads
      (`NEXT_PUBLIC_GADS_SIGNUP/ACTIVATE/SUBSCRIBE`) — sem isso a mídia otimiza no escuro.
- [ ] Subir campanha **Google Search** (R$ 12/dia) — termos de alta intenção
      (`transcrever áudio whatsapp`, `transformar áudio em texto whatsapp`,
      `resumir áudio whatsapp`, + nicho corretor). Negativas: grátis/baixar/free/crackeado.
      Anúncio → `/corretores` ou `/transcrever-audio-gratis`.
- [ ] Mensagem de divulgação em **15–20 grupos de WhatsApp** (dar valor 2–3 dias antes do link).
- [ ] **3 posts no LinkedIn** (ritmo de 3/semana o mês todo).
- [ ] Garantir "aha" < 3 min (cadastro → 1ª transcrição).
- **Meta da semana:** ~20–30 cadastros, primeiros 2–4 pagantes.

## Semana 2 — Mídia paga + retargeting semeado
**Objetivo: acelerar com tráfego pago e ativar o loop viral.**
- [ ] Subir campanha **Meta** (R$ 5/dia) — prospecção "corretor/CRECI/imobiliário",
      criativo vídeo 15s (áudio → texto + resumo). Semeia pixel p/ retargeting.
- [ ] Regra: não mexer na campanha todo dia (acumular 4–5 dias); matar o que não
      traz cadastro em 7 dias.
- [ ] Divulgar a ferramenta grátis `/transcrever-audio-gratis` (isca de topo, SEO + share).
- [ ] Acompanhar o **rodapé viral** (commit 4c232f3): tráfego com `utm_campaign=viral`
      no GA/Search Console — é o loop K-factor (quem recebe a transcrição vê a marca).
- **Meta da semana acumulada:** ~50 cadastros, 8–12 pagantes.

## Semana 3 — Conteúdo e otimização do funil
**Objetivo: colher SEO e destravar conversão.**
- [ ] Publicar/promover posts SEO (clusters: "como fazer", por nicho, dor/comparação).
      Já no ar: iPhone/Android/PC + os 4 originais. Linkar internamente p/ LP do nicho.
- [ ] Analisar onde os cadastros travam: cadastro → conexão WhatsApp → 1º envio → pagamento.
- [ ] Reforçar e-mails de ciclo de vida (boas-vindas, 1ª transcrição c/ indicação,
      upgrade por uso, upgrade do Free engajado, win-back).
- [ ] A/B do rodapé viral (variantes a/b) — ver qual `utm_content` converte melhor.
- **Meta da semana acumulada:** ~75 cadastros, 18–24 pagantes.

## Semana 4 — Conversão e fechamento da meta
**Objetivo: empurrar quem está na borda para o Pro.**
- [ ] Retargeting Meta nos não-convertidos (pixel já aquecido).
- [ ] Paywall por valor: alerta de upgrade ancorado no tempo economizado (já no ar).
- [ ] Pulso de outreach final + reforço da oferta Fundador (escassez/prazo).
- [ ] Revisar números: CAC por canal, conversão por etapa, decidir o que escala no mês 2.
- **Meta final:** 100 cadastros, 30 pagantes, ~R$ 1.197 MRR.

---

## Canais e ativos
- **Google Search:** R$ 350/mês — esperado ~15–25 cadastros.
- **Meta:** R$ 150/mês — prospecção + semeia retargeting.
- **Outreach manual:** grupos WhatsApp + LinkedIn (maior fonte de cadastros).
- **SEO/blog:** colhe em 60–90 dias; já há corpus forte em `apps/web/src/app/blog/posts.ts`.
- **Loop viral:** rodapé da transcrição (worker) com link UTM rastreado.
- **Isca de topo:** `/transcrever-audio-gratis`.

## Como medir
- Cadastros/pagantes: painel admin.
- Tráfego viral: GA/Search Console, filtro `utm_campaign=viral`.
- Mídia paga: Google Ads + Meta Ads Manager (CAC ≤ R$ 16).
- Funil: taxa cadastro→conexão→1º envio→pagamento.
