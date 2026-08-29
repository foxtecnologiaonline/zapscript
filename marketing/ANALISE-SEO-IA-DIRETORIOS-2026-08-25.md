# Análise consolidada — SEO, Rankeamento Google, Busca por IA e Diretórios
**ZapScript · 2026-08-25**

> Escopo: visibilidade orgânica (4 pilares abaixo). Mídia paga e funil ficam de
> fora — isso é o `PLANO-MARKETING-30D.md` (vencido, tratado só como pano de
> fundo de budget aqui). Este documento sintetiza o que já existe em
> `marketing/SEO-20-KEYWORDS-E-ADS-CONCORRENTES.md`,
> `marketing/DISTRIBUICAO-E-VISIBILIDADE.md`, `marketing/CADASTRO-DIRETORIOS.md`
> e `marketing/KIT-OUTREACH-BACKLINKS.md` — não reescreve nenhum deles — e
> adiciona verificação ao vivo (WebSearch) feita hoje para confirmar o que é
> real e o que é suposição desatualizada.

---

## TL;DR

1. **O achado mais importante desta análise: os 4 pilares têm 1 causa-raiz só.**
   SEO técnico e a fundação de GEO/AEO estão praticamente prontos (código
   confirmado). Rankeamento no Google e citação por IA estão em zero — não
   porque falte conteúdo ou schema, mas porque o domínio tem **zero
   autoridade externa** (backlinks, diretórios, menções). É a mesma causa
   travando os dois. Resolver diretórios/backlinks resolve os outros dois.
2. **Confirmado ao vivo hoje:** `site:zapscript.me` continua sem retornar
   nenhuma página do domínio; nas buscas de cabeça ("transcrever áudio
   whatsapp", "converter áudio em texto whatsapp") o ZapScript não aparece —
   quem domina é Tecnoblog, Exame, Zapia, ViraTexto. Nenhum dos diretórios
   prioritários (Product Hunt, AlternativeTo, SaaSHub, G2) tem listagem do
   ZapScript. **Zero indício de execução do checklist de diretórios.**
3. **Boa notícia que corrige os documentos anteriores:** a "canibalização de
   3 posts por nicho" apontada no doc de keywords **não reflete mais a
   realidade do código** — conferi `posts.ts` linha a linha e é 1 post em
   advogados, 2 em corretores e 2 em vendas, com keywords e ângulos
   diferentes (geral vs. autônomo/solo). Risco de canibalização é baixo, não
   alto. **Não precisa consolidar nada.** Além disso, os 2 posts de gap que o
   doc de keywords listava como "ainda não criados" (preço e SAC/atendimento)
   **já existem** (`quanto-custa-transcrever-audio-whatsapp` e
   `transcricao-audio-whatsapp-atendimento-ao-cliente`, ambos de 2026-06-27).
   Conclusão prática: **pare de produzir conteúdo por enquanto.** O gargalo
   não é lá.
4. **Concorrente ZapVox (zapvoxia.com.br) é ameaça real, não teórica** — blog
   ativo e indexado, Pro a R$29,90/mês (mais barato que o Profissional do
   ZapScript a R$49/mês), mas é uma extensão de Chrome manual (clica por
   áudio, só funciona no WhatsApp Web aberto) — não é automação de verdade.
   Diferenciação clara e defensável a explorar.
5. **A única ação com alavancagem real agora é executar o que já está
   escrito:** `marketing/CADASTRO-DIRETORIOS.md` (checklist + copy prontos) e
   `marketing/KIT-OUTREACH-BACKLINKS.md` (alvos + e-mail prontos). Custo:
   R$0. Esforço: do founder, algumas horas por semana. Isso é o P0.

---

## A) Verificação ao vivo (2026-08-25)

### A.1 — Rankeamento Google: continua em zero
- `site:zapscript.me` → **zero resultados do domínio real.** Só aparecem
  domínios homônimos não relacionados (zapscript.net, uma empresa de peças
  automotivas chinesa; zaparoo.org, projeto de hardware). Isso repete
  exatamente o achado da auditoria de 2026-08-22 — **3 dias depois, nada
  mudou**, o que é esperado (nenhuma ação de autoridade foi executada nesse
  intervalo).
- `"zapscript.me"` (busca exata entre aspas, para capturar qualquer menção
  externa, não só `site:`) → **também zero.** Não há nenhuma citação externa
  detectável ao domínio hoje.
- `transcrever áudio whatsapp` → top resultados: Tecnoblog, Blip/ViraTexto,
  Exame, Zapia, Chrome Web Store. ZapScript não aparece.
- `converter áudio em texto whatsapp` → top resultados: Tecnoblog, Red Bull,
  Exame, apps de loja. ZapScript não aparece.
- **Leitura:** isso confirma e reforça o achado do KIT-OUTREACH — Tecnoblog e
  Exame são, na prática, quem domina exatamente as keywords que o ZapScript
  mais precisa. São os alvos certos de outreach, validados ao vivo hoje (não
  é suposição do kit anterior).
- **Ressalva de método:** a ferramenta de busca usada aqui não é o Google
  Search Console — é uma boa aproximação, mas não 100% garantida (o operador
  `site:` pode não ser tratado de forma idêntica). Como o resultado de hoje
  bate exatamente com a auditoria de 3 dias atrás (fonte independente), a
  confiança é alta. Ainda assim, **o founder deveria confirmar isso 1x no
  Google Search Console** (Cobertura/Indexação) — é grátis, leva 15 minutos,
  e distingue duas situações bem diferentes: (a) páginas indexadas mas sem
  força para rankear [normal para domínio novo sem backlinks] vs. (b)
  páginas não indexadas de verdade [seria um problema técnico a investigar,
  embora a auditoria anterior já tenha descartado isso]. Ver P0 abaixo.

### A.2 — Diretórios: nenhum confirmado como feito
Busquei especificamente pelos 4 de maior prioridade do checklist:
- **Product Hunt** — nenhum resultado de "ZapScript" como produto.
- **AlternativeTo** — nenhuma página `alternativeto.net/software/zapscript*`.
- **SaaSHub** — nenhuma página do ZapScript.
- **G2** — nenhum perfil/review na categoria Transcription.

**Conclusão:** os checkboxes vazios em `CADASTRO-DIRETORIOS.md` refletem a
realidade — **nada foi submetido ainda**, não é só desatualização do
arquivo. Isso é o gap de maior impacto disponível agora (ver P0).

### A.3 — Concorrente ZapVox (zapvoxia.com.br): urgência real, calibrada
- **Modelo:** extensão de navegador (Chrome/Edge) para WhatsApp **Web** —
  usuário clica num botão ao lado do áudio recebido para transcrever aquele
  áudio específico. Também traduz e resume áudios longos.
- **Preço:** Free = 10 transcrições/dia sem cartão; Pro = **R$29,90/mês** ou
  R$199,90/ano — abaixo do Profissional do ZapScript (R$49/mês).
- **Conteúdo:** blog ativo e **indexado de verdade** — encontrei múltiplos
  posts individuais nos resultados de busca ("ler áudio whatsapp sem
  escutar", "resumir áudio 10 minutos whatsapp", "transcrever áudio whatsapp
  chrome"). Isto é, o ZapVox está fazendo exatamente o que falta ao
  ZapScript: aparecendo no Google.
- **Diferenciação real e defensável do ZapScript:** ZapVox é **manual e
  depende do WhatsApp Web aberto no navegador** (não funciona se você só usa
  o app no celular, não roda em segundo plano). ZapScript é **automático**,
  conecta direto ao número e processa todo áudio recebido sem exigir
  navegador aberto nem clique por mensagem. Isso é uma mensagem de
  posicionamento pronta para usar: "extensão que você clica" vs "automação
  que roda sozinha".
- **Ação sugerida:** criar `/vs/zapvox` como 7º comparativo (ver P2). Não é
  urgente — é P2 porque o ZapScript ainda nem aparece no Google para ter
  tráfego que leia esse comparativo — mas é barato e o gap de conteúdo
  comparativo deveria ser fechado antes que o ZapVox cresça mais.

### A.4 — Presença em busca por IA (GEO/AEO)
Não simulei literalmente uma conversa de ChatGPT (fora de escopo pedido),
mas as buscas amplas de marca/categoria ("zapscript transcrever áudio
whatsapp avaliação") — que são o melhor proxy disponível para o que uma IA
generativa também encontraria ao pesquisar — **não citaram o ZapScript em
nenhum resultado**. Quem aparece: Zapia, ViraTexto, LuzIA, WhatsApp nativo.
**Isso é consistente com o achado central:** a fundação técnica de GEO
(schema, `llms.txt`, `robots.txt` liberando bots de IA) está pronta, mas as
IAs citam principalmente diretórios/reviews/imprensa — que ainda não existem
para o ZapScript. Fundação pronta + zero combustível externo = zero citação.

---

## B) Diagnóstico por pilar

| Pilar | Status real | Evidência |
|---|---|---|
| **SEO técnico** (schema, sitemap, robots, llms.txt) | ✅ **Feito** (~95%) | JSON-LD `SoftwareApplication` (`apps/web/src/app/page.tsx:79`), `llms.txt` (`apps/web/public/llms.txt`), `robots.txt` liberando GPTBot/ClaudeBot/PerplexityBot/etc. e bloqueando scrapers de baixo valor (`apps/web/public/robots.txt`), 6 páginas comparativas (`apps/web/src/app/vs/{otter,notta,viratexto,luzia,transkriptor,zapia}/page.tsx`) — tudo confirmado no código. |
| **SEO conteúdo** (blog + LPs de nicho) | ✅ **Feito** (~90%) | 25 posts em `apps/web/src/app/blog/posts.ts`, LPs `/corretores` `/advogados` `/vendas`. Os 2 gaps genuínos (#19 preço, #20 SAC) já foram criados. Canibalização reavaliada hoje: risco baixo, não precisa consolidar (ver seção A e item D.1). |
| **Rankeamento Google** | ❌ **Zero resultado** | `site:zapscript.me` = 0 páginas; ZapScript não aparece em nenhuma das 2 keywords de cabeça testadas hoje. **Isto é efeito, não causa** — é o pilar mais visível, mas o problema real está em Diretórios/Backlinks abaixo. |
| **Busca por IA — fundação técnica** | ✅ **Feito** (100%) | Mesma infra do SEO técnico serve GEO: schema, `llms.txt`, robots liberando crawlers de IA. |
| **Busca por IA — citação externa** | ❌ **Zero** | Nenhuma citação/menção encontrada em nenhuma busca. Mesma causa-raiz de Diretórios: LLMs citam principalmente diretórios/reviews/imprensa que ainda não existem para o ZapScript. |
| **Diretórios** | ❌ **Não tocado** (0 de 20 confirmados) | Product Hunt, AlternativeTo, SaaSHub, G2 checados ao vivo hoje — nenhum tem o ZapScript. Checklist pronto em `marketing/CADASTRO-DIRETORIOS.md`, zero execução confirmada. |
| **Backlinks / outreach editorial** | ❌ **Não tocado** (0 e-mails) | Kit pronto em `marketing/KIT-OUTREACH-BACKLINKS.md`, alvos validados ao vivo hoje (Tecnoblog e Exame de fato dominam as buscas-alvo), sem planilha de acompanhamento, sem evidência de envio. |

**Leitura direta:** você não tem 4 problemas, tem 1. Conteúdo e fundação
técnica estão prontos e maduros — parar de mexer aí agora é a decisão
certa. Tudo o que falta é autoridade externa, e isso só se compra com
diretórios + outreach, que já estão escritos e prontos para executar.

---

## C) Plano de ação — priorizado por impacto x esforço x custo

Budget de mídia (R$500/mês) **não é necessário aqui** — os 20 diretórios do
checklist são gratuitos e outreach é e-mail. Este plano consome apenas
tempo do founder.

### P0 — esta semana (25/08 a 31/08), ~4-6h, custo R$0
| # | Ação | Onde | Esforço |
|---|---|---|---|
| 1 | Submeter aos 5 diretórios da Semana 1: AlternativeTo, SaaSHub, BetaList, Indie Hackers, Futurepedia | Executar checklist + copy pronta em `marketing/CADASTRO-DIRETORIOS.md` (não recriar copy, já está lá) | 2-3h |
| 2 | Confirmar status real de indexação no Google Search Console (propriedade zapscript.me) | Login do founder — ver Cobertura/Páginas indexadas e Performance/posição média das 20 keywords de `marketing/SEO-20-KEYWORDS-E-ADS-CONCORRENTES.md` | 15-20min |
| 3 | Atualizar `marketing/SEO-20-KEYWORDS-E-ADS-CONCORRENTES.md`: marcar #19 e #20 como já criados, corrigir a nota de "3x duplicado" para o achado real de hoje (1 post advogados, 2+2 com ângulos distintos em corretores/vendas) | Edição de documento, 10min | 10min |

### P1 — próximas 2-4 semanas (até 22/09), ~6-10h, custo R$0
| # | Ação | Onde | Esforço |
|---|---|---|---|
| 4 | Semanas 2 e 3 do checklist de diretórios: Product Hunt (escolher e agendar terça/quarta), G2, Capterra/GetApp, There's An AI For That, aitools.fyi, StartupBase, ABStartups, Distrito, Crunchbase, F6S | `marketing/CADASTRO-DIRETORIOS.md` | 4-6h distribuídas |
| 5 | Criar planilha simples de outreach (veículo \| contato \| data envio \| status \| link publicado) e enviar os 2 primeiros e-mails — **Tecnoblog e Exame**, confirmados hoje ao vivo como quem realmente domina as keywords-alvo | Template pronto em `marketing/KIT-OUTREACH-BACKLINKS.md` | 2h |
| 6 | Interlinking entre os pares de posts de nicho com overlap parcial: corretores ↔ corretor autônomo; vendas (SDR/closer) ↔ vendedor autônomo — 1 link contextual em cada, reforça ao Google que são artigos complementares, não concorrentes | `apps/web/src/app/blog/posts.ts` — campo `content` (HTML) dos posts `transcrever-audio-whatsapp-corretores`, `transcricao-audio-whatsapp-corretor-autonomo`, `transcrever-audio-whatsapp-vendas`, `transcricao-audio-whatsapp-vendedor-autonomo` | 30min |

### P2 — mês 2 em diante (setembro/outubro), condicional a P0/P1 executados
| # | Ação | Onde | Esforço |
|---|---|---|---|
| 7 | Criar `/vs/zapvox` (7º comparativo) — ângulo: automação real vs extensão manual de WhatsApp Web | Novo arquivo `apps/web/src/app/vs/zapvox/page.tsx`, seguindo o padrão de `apps/web/src/app/vs/transkriptor/page.tsx`; atualizar `apps/web/src/app/sitemap.ts` | ~1h (reuso de template) |
| 8 | Continuar outreach: Canaltech, Olhar Digital, SendPulse (ângulo de parceria, não citação direta); follow-up único dos 2 primeiros e-mails após 7-10 dias sem resposta | `marketing/KIT-OUTREACH-BACKLINKS.md` | contínuo |
| 9 | Teste mensal de GEO: perguntar em ChatGPT/Perplexity/Gemini/Claude "qual app transcreve áudio do WhatsApp automaticamente" e registrar se cita o ZapScript | Manual, 4 prompts | 10min/mês |
| 10 | Pedir reviews a usuários Pro satisfeitos assim que os perfis G2/Capterra estiverem no ar — é a fonte que mais pesa em respostas de IA segundo `marketing/DISTRIBUICAO-E-VISIBILIDADE.md` | E-mail/WhatsApp direto a clientes Pro ativos | contínuo |

**Por que não criar mais conteúdo agora:** o diagnóstico de hoje mostra
conteúdo maduro (25 posts, 6 comparativos, gaps preenchidos) competindo por
keywords que nem sequer aparecem no Google por falta de autoridade — mais
posts não mudam isso. Reavaliar produção de conteúdo novo só depois que P0/P1
começarem a gerar backlinks reais (ver E, cadência de revisão).

---

## D) Decisões que só o founder pode tomar

1. **Consolidar posts de nicho — não precisa mais decidir.** O achado de
   hoje corrige o doc anterior: não há duplicação real (keywords e ângulos
   diferentes). Recomendação: seguir com o interlinking leve do P1.6 e
   encerrar essa pendência sem merge/redirect.
2. **Gaps #19 (preço) e #20 (SAC) — também não precisa mais decidir.** Já
   foram criados (`quanto-custa-transcrever-audio-whatsapp` e
   `transcricao-audio-whatsapp-atendimento-ao-cliente`). Só falta atualizar
   o doc de keywords para refletir isso (P0.3).
3. **Criar `/vs/zapvox`?** Recomendação: sim, mas é P2. Decisão do founder é
   só o timing.
4. **Quem executa outreach de fato?** O kit é claro que precisa de um humano
   mandando e-mail e acompanhando resposta — na prática, isso é o founder.
   Confirmar que ele mesmo vai enviar ou se há alguém do time para delegar.
5. **Data de lançamento no Product Hunt.** Precisa ser terça ou quarta,
   de manhã (horário US), e idealmente com uma rede avisada para dar
   upvote/comentário nas primeiras horas — isso é agenda do founder, não dá
   para automatizar.
6. **Fora de escopo, mas flagrando:** o doc de keywords ainda lista como
   pendente "estender ou não a promo Fundador" que expirava em 2026-06-30 —
   isso já passou há quase 2 meses. Se a promo ainda estiver ativa no site
   por inércia, vale checar e decidir oficialmente — mas isso é pricing, não
   SEO/diretório; pertence ao `PLANO-MARKETING-30D.md`, não a este plano.
7. **Confirmar que diretórios/outreach não competem pelo budget de mídia.**
   Os 20 diretórios do checklist são gratuitos; outreach é e-mail. O R$500/mês
   de mídia paga fica 100% preservado para o outro plano.

---

## E) Como medir e cadência de revisão

| Pilar | Métrica | Fonte |
|---|---|---|
| Rankeamento Google | Posição média das 20 keywords de `SEO-20-KEYWORDS-E-ADS-CONCORRENTES.md`; nº de páginas indexadas; cliques/impressões orgânicas | Google Search Console (grátis — configurar/checar já é o P0.2) |
| Diretórios | Nº de diretórios com listing ativo / 20 do checklist; tráfego com `utm_medium=listing&utm_campaign=directories` | Checklist manual + GA4 |
| Backlinks / outreach | Nº de e-mails enviados; taxa de resposta; backlinks publicados / meta de 3-5 em 90 dias | Planilha de acompanhamento (criar no P1.5) + Google Search Console (aba Links) |
| Busca por IA (GEO/AEO) | Citado ou não nos 4 prompts mensais; tráfego com `utm_source=chatgpt.com` / `perplexity.ai` (referral) | Teste manual mensal + GA4 |
| SEO conteúdo | Sessões orgânicas por post/LP; sem meta nova — já maduro, só monitorar declínio | GA4 |

**Cadência sugerida:**
- **Quinzenal (15min):** repetir `site:zapscript.me` + as 2 keywords de
  cabeça testadas hoje + checar impressões no Search Console. Serve só para
  confirmar que algo mudou (ou não) — não é hora de agir, é hora de saber se
  o P0/P1 está funcionando.
- **Mensal (1h):** revisão completa — nº de diretórios concluídos vs. meta,
  status da planilha de outreach, os 4 prompts de IA, posição média das 20
  keywords no Search Console. É neste checkpoint que se decide se already
  vale reabrir produção de conteúdo (P2 tardio) ou se ainda é cedo.
- **Gatilho para reagir fora do calendário:** qualquer backlink publicado
  (validar se moveu alguma keyword) ou qualquer sinal de que o ZapVox
  ganhou posição nova no Google para uma keyword que o ZapScript também
  disputa.

---

## Próximo passo objetivo

Hoje: abrir `marketing/CADASTRO-DIRETORIOS.md` e cadastrar o ZapScript em
**AlternativeTo** e **SaaSHub** (os 2 de maior peso para citação por IA
segundo `DISTRIBUICAO-E-VISIBILIDADE.md`) — copy e imagens já prontas, é
copiar e colar. 30-40 minutos, R$0, é a ação isolada de maior alavancagem
disponível neste momento.
