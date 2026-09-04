# 20 buscas-alvo + Ads contra 5 concorrentes — ZapScript

## ⚠️ Achado importante antes de tudo: cabotagem de conteúdo (cannibalization)

O blog já tem **3 posts quase duplicados** para os mesmos nichos:
- Advogados: 3 posts diferentes competindo pela mesma keyword cluster
- Corretores: 3 posts diferentes
- Vendas/vendedores: 3 posts diferentes (incluindo o novo "vendedor autônomo" criado nesta sessão)

**Problema real:** posts duplicados para a mesma keyword competem entre si no Google (o Google escolhe 1, raramente os 2) e diluem backlinks/autoridade. Adicionar um 4º post de advogados não ajuda — pode piorar.

**Recomendação:** antes de criar mais conteúdo para advogados/corretores/vendas, consolidar os 3 posts de cada nicho em 1 só (ou usar 301 redirect dos 2 mais fracos para o mais forte). Não fiz isso agora porque é uma decisão de conteúdo existente, não geração de conteúdo novo — avise se quiser que eu faça esse merge.

Por isso, abaixo eu **não dupliquei** advogados/corretores/vendas. Criei conteúdo só para gaps genuínos.

## ✅ Correção 2026-09-04: alerta de canibalização acima está desatualizado

`marketing/ANALISE-SEO-IA-DIRETORIOS-2026-08-25.md` (item 3 do TL;DR) revisou
`posts.ts` linha a linha e chegou a uma contagem diferente da que abre este
documento: **1 post em advogados, 2 em corretores e 2 em vendas**, com
keywords e ângulos diferentes (geral vs. autônomo/solo) — não 3 posts quase
duplicados por nicho. Risco de canibalização real é **baixo**, e as duas
lacunas que este doc listava como "ainda não criadas" (preço e SAC) **já
existem** (`quanto-custa-transcrever-audio-whatsapp` e
`transcricao-audio-whatsapp-atendimento-ao-cliente`). **Não consolidar nem
fazer 301 redirect** — o interlinking leve entre os pares de nicho já foi
feito em `apps/web/src/app/blog/interlinks.ts`. O gargalo real de
visibilidade não é conteúdo (ver bloco abaixo e a auditoria de 08-25): é
autoridade externa — diretórios e backlinks, ainda não executados.

---

## ⚠️ Atualização 2026-08-22: concorrente novo encontrado, visibilidade orgânica em zero

Auditoria de marketing (2026-08-22) rodou `site:zapscript.me` e buscas pela
marca isolada — **zero páginas do domínio retornadas**, nem por marca nem por
categoria. Não é problema técnico (sitemap/robots/structured data OK) — é
falta de backlinks/diretórios, exatamente o achado já registrado na seção de
outreach abaixo, mas ainda não executado.

Nas buscas de validação apareceu um concorrente direto **não mapeado nesta
lista**: **ZapVox** (zapvoxia.com.br) — blog ativo em SEO com posts tipo
"resumir áudio 10 minutos whatsapp", "transcrever áudio whatsapp chrome".
Adicionar aos 5 concorrentes rastreados. **Zapia** também ganhou cobertura de
imprensa recente (TI Inside/TechTudo) — vale reavaliar prioridade.

## As 20 maiores buscas relevantes (Brasil, intenção comercial/informacional)

| # | Keyword | Volume relativo | Status no site | Ação |
|---|---|---|---|---|
| 1 | transcrever áudio whatsapp | Alto | ✅ Cobertura forte (home + blog) | Mantido |
| 2 | transcrição de áudio whatsapp | Alto | ✅ Cobertura forte | Mantido |
| 3 | converter áudio em texto whatsapp | Alto | ✅ `/transcrever-audio-gratis` | Mantido |
| 4 | como transcrever áudio do whatsapp grátis | Alto | ✅ `/transcrever-audio-gratis` | Mantido |
| 5 | transcrever áudio whatsapp para texto online | Médio-alto | ✅ Cobertura forte | Mantido |
| 6 | resumo de áudio whatsapp | Médio | ✅ Home + blog | Mantido |
| 7 | app para transcrever áudio do whatsapp | Médio | ⚠️ Parcial (sem página dedicada "app") | Gap — considerar |
| 8 | transcrição de áudio para advogados | Médio | ⚠️ 3x duplicado | Consolidar, não criar |
| 9 | transcrição de áudio para corretores de imóveis | Médio | ⚠️ 3x duplicado | Consolidar, não criar |
| 10 | transcrever áudio de cliente vendas | Médio | ⚠️ 3x duplicado | Consolidar, não criar |
| 11 | transcrição de áudio para psicólogos | Médio | ✅ Criado nesta sessão | Mantido |
| 12 | transcrever áudio whatsapp dentista clínica | Baixo-médio | ✅ `/dentistas` criado nesta sessão | Mantido |
| 13 | transcrever áudio whatsapp contador | Baixo-médio | ✅ `/para/contabilidade` | Mantido |
| 14 | alternativa ao otter.ai em português | Médio | ✅ `/vs/otter` | Mantido |
| 15 | viratexto alternativa | Baixo-médio | ✅ `/vs/viratexto` | Mantido |
| 16 | luzia transcrição áudio | Baixo-médio | ✅ `/vs/luzia` | Mantido |
| 17 | notta ai em português | Baixo | ✅ `/vs/notta` | Mantido |
| 18 | transkriptor em português / preço brasil | Baixo-médio | ✅ **`/vs/transkriptor` — criado agora** | Novo |
| 19 | quanto custa transcrever áudio whatsapp | Baixo-médio | ❌ Gap real | **Criar FAQ/seção de preço otimizada** |
| 20 | transcrição de áudio whatsapp para atendimento ao cliente | Médio | ❌ Gap real (caso de uso B2B/SAC) | **Criar página/post de gap genuíno** |

### Gaps genuínos identificados (#19 e #20) — ainda não criados
Recomendo criar:
- Um post de blog respondendo diretamente "quanto custa transcrever áudio do whatsapp" (comparando Free/Pro/concorrentes, otimizado para featured snippet).
- Uma página/post para "atendimento ao cliente" (SAC, suporte, customer success) — público B2B diferente dos 3 nichos já saturados, sem risco de canibalização.

Quer que eu crie essas duas agora? Não criei ainda para confirmar prioridade, já que envolve uma keyword de preço (sensível, junho tem promo expirando) e uma de público novo (SAC) que exige um ICP diferente dos já mapeados.

---

## 5 concorrentes identificados

1. **Otter.ai** — já tem `/vs/otter`
2. **Notta** — já tem `/vs/notta`
3. **ViraTexto** — já tem `/vs/viratexto`
4. **LuzIA** — já tem `/vs/luzia`
5. **Transkriptor** — **novo, criado nesta sessão** (`/vs/transkriptor`), real concorrente internacional de transcrição genérica, sem foco em WhatsApp/Brasil — diferenciação clara e defensável.

---

## Anúncios de busca direta pelos concorrentes (Google Ads RSA — pronto para colar)

> Estratégia: campanha de Search por marca de concorrente, segmentando quem já busca pelo nome dele (alta intenção, baixo CPC por ser nicho). Sem acesso à plataforma de Ads nesta sessão — copy abaixo é para colar direto ao criar a campanha.

### Negative keywords (aplicar em todas as 5 campanhas)
```
-grátis (se promo já tiver expirado)
-emprego
-vaga
-curso
-download crackeado
-pirata
```

### Campanha 1 — Otter.ai
**Keywords (Frase/Exata):** "otter.ai", "otter ai português", "alternativa otter ai", "otter ai brasil"
**Headlines (até 30 car.):**
1. Alternativa ao Otter.ai em PT-BR
2. Transcreve Áudio do WhatsApp
3. Otter Não Conecta no WhatsApp
4. Plano Grátis, Preço em Real
5. Resumo IA + Texto Automático
**Descriptions (até 90 car.):**
1. O Otter.ai não conecta no WhatsApp. O ZapScript converte áudio automaticamente, em português.
2. Compare ZapScript vs Otter.ai. Veja por que somos a opção certa para WhatsApp no Brasil.
**Final URL:** zapscript.me/vs/otter

### Campanha 2 — Notta
**Keywords:** "notta ai", "notta português", "notta brasil", "alternativa notta"
**Headlines:**
1. Alternativa à Notta em Português
2. Feito para Áudio do WhatsApp
3. Notta é Genérico, Nós Somos Foco
4. Comece Grátis, Sem Cartão
5. Compare Notta vs ZapScript
**Descriptions:**
1. Notta transcreve reuniões. ZapScript transcreve o WhatsApp automaticamente. Veja a diferença.
2. Preço em real, suporte em português, conectado direto no seu número.
**Final URL:** zapscript.me/vs/notta

### Campanha 3 — ViraTexto
**Keywords:** "viratexto", "viratexto alternativa", "viratexto preço"
**Headlines:**
1. ViraTexto vs ZapScript: Compare
2. Mais Recursos, Mesmo Preço em R$
3. Resumo com IA Incluso
4. Modo Privado + Histórico
5. Teste Grátis Agora
**Descriptions:**
1. Veja o comparativo direto entre ViraTexto e ZapScript antes de escolher.
2. Conversão automática de áudio do WhatsApp, com resumo por IA incluso no plano Free.
**Final URL:** zapscript.me/vs/viratexto

### Campanha 4 — LuzIA
**Keywords:** "luzia transcrição", "luzia áudio whatsapp", "luzia alternativa"
**Headlines:**
1. LuzIA é Assistente, Nós Somos Foco
2. Especialista em Transcrever WhatsApp
3. LuzIA vs ZapScript: Veja Diferenças
4. Sem Cartão para Começar
5. Resumo Automático por IA
**Descriptions:**
1. LuzIA é um assistente geral. ZapScript é especializado em transcrever o WhatsApp.
2. Conecte seu número e converta áudio em texto automaticamente, 24h por dia.
**Final URL:** zapscript.me/vs/luzia

### Campanha 5 — Transkriptor (novo)
**Keywords:** "transkriptor", "transkriptor português", "transkriptor preço", "transkriptor brasil"
**Headlines:**
1. Transkriptor em Português? Veja Isto
2. Sem Upload Manual de Áudio
3. Conecta Direto no seu WhatsApp
4. Preço em Real, Não em Dólar
5. Transkriptor vs ZapScript: Compare
**Descriptions:**
1. Transkriptor exige upload manual. ZapScript converte o áudio do WhatsApp sozinho.
2. Feito para o Brasil: português, preço em real, servidores em SP, LGPD.
**Final URL:** zapscript.me/vs/transkriptor

---

## O que foi criado nesta sessão (código)
- `apps/web/src/app/vs/transkriptor/page.tsx` — nova página comparativa (5º concorrente)
- `apps/web/src/app/sitemap.ts` — atualizado com a nova rota
- Verificado via preview: 200 OK, sem erros, conteúdo renderizando corretamente

## Pendente de decisão sua
1. Consolidar os 3 posts duplicados de advogados/corretores/vendas em 1 cada (recomendado antes de criar mais conteúdo nesses nichos)
2. Confirmar se crio os 2 posts de gap genuíno (#19 preço, #20 atendimento/SAC)
3. Resposta pendente da sessão anterior: estender ou não a promo "Fundador" que expira 2026-06-30
