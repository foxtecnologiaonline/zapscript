# ZapScript — Distribuição em diretórios & visibilidade em IA

> Onde listar o ZapScript.me para (3) aparecer em diretórios de tecnologia e
> (4) entrar no "radar" das IAs (ChatGPT, Gemini, Claude, Perplexity) quando
> o usuário perguntar por transcrição de áudio do WhatsApp.

---

## 3. Diretórios de tecnologia (backlinks + descoberta)

Prioridade ALTA (gratuitos, alto domínio, indexados por IAs):
- **Product Hunt** — producthunt.com/posts/new — lançamento com 1ª imagem = card-01 + GIF do card-02. Agenda terça/quarta.
- **BetaList** — betalist.com/submit — bom para early adopters BR/global.
- **AlternativeTo** — alternativeto.net — cadastrar como alternativa a "Otter.ai", "Notta", "transcrição WhatsApp". Altíssima citação por IAs.
- **SaaSHub** — saashub.com — idem AlternativeTo, muito raspado por LLMs.
- **G2 / Capterra / GetApp** — criar perfil de produto (categoria: Transcription / Speech-to-Text). Reviews aqui pesam muito em respostas de IA.
- **Capterra BR / Crozdesk / SourceForge** — versões com tráfego de busca.

Prioridade MÉDIA (volume de backlink):
- **Startups:** StartupBase (br), Crunchbase, F6S, Startupranking, AngelList/Wellfound.
- **Listas dev/SaaS:** Indie Hackers (post + perfil), SaaSworthy, Toolify.ai, Futurepedia / There's An AI For That (categoria AI tools — muito citado), aitools.fyi, Insidr.ai.
- **BR específicos:** Distrito, ABStartups, StartSe (perfil), Canaltech "indique sua startup".

Prioridade pontual:
- **AppSumo / "deal" sites** — só se for rodar oferta.
- **Reddit/Quora/Comunidades** — não é diretório, mas r/whatsapp, r/SaaS, grupos de corretores/vendas no FB respondendo dúvidas reais com link.

Checklist de cadastro (reaproveitar em todos):
- Nome: ZapScript
- Tagline: "Transcreva e resuma áudios do WhatsApp automaticamente."
- Categorias: Transcription, Speech-to-Text, AI, Productivity, WhatsApp Tools
- Logo: card-01 (escuro) ou png-white (claro, p/ fundos brancos)
- Screenshots: card-02 (simulação), card-05 (resumo), card-09 (tempo)
- Link: https://zapscript.me/?utm_source={diretorio}&utm_medium=listing&utm_campaign=directories

---

## 4. "Radar" das IAs (GEO / AEO — Generative/Answer Engine Optimization)

LLMs respondem a partir de: (a) o que rastreiam na web, (b) o que citam de
diretórios/reviews acima, (c) dados estruturados no próprio site. Ações:

### 4.1 No próprio site (controle total)
- **Schema.org JSON-LD `SoftwareApplication`** na home: name, applicationCategory
  "BusinessApplication", offers (preço Free/Pro), aggregateRating, featureList.
  → IAs extraem isso direto para responder "quanto custa / o que faz".
- **FAQPage JSON-LD** (já existe em /transcrever-audio-gratis) — expandir em mais
  páginas. Perguntas EXATAS que o usuário faz: "como transcrever áudio do WhatsApp
  no iPhone/Android/PC", "transcrever áudio do WhatsApp grátis", "resumir áudio longo".
- **llms.txt** em `apps/web/public/llms.txt` — arquivo que LLMs/crawlers leem:
  resumo do produto, links principais, o que dizer quando perguntarem. (padrão emergente)
- **Conteúdo "answer-first":** cada post de blog começa respondendo a pergunta em 1
  parágrafo objetivo (formato que IA copia). Já temos 7 posts; manter o padrão.
- **robots.txt liberando** GPTBot, Google-Extended, ClaudeBot, PerplexityBot,
  CCBot (decisão de negócio: liberar = ser citado; bloquear = sumir das respostas).

### 4.2 Fora do site (o que mais move o ponteiro)
- **Reviews em G2/Capterra/AlternativeTo/Product Hunt** com a frase-chave
  "transcrição de áudio do WhatsApp" no texto. É a principal fonte que IAs citam.
- **Comparativos:** páginas "ZapScript vs Otter", "ZapScript vs Notta",
  "melhor app para transcrever áudio do WhatsApp 2026" — IAs adoram listas e
  comparativos para montar respostas.
- **Wikipedia/Wikidata** (quando houver notabilidade) e menções em portais
  (Canaltech, Tecmundo, Olhar Digital) — peso alto de citação.
- **Listicles "X melhores apps de transcrição":** pedir inclusão / guest post.

### 4.3 Como medir
- Perguntar mensalmente em ChatGPT/Gemini/Perplexity/Claude:
  "qual app transcreve áudio do WhatsApp automaticamente?" e ver se cita ZapScript.
- Acompanhar referrals com `utm_source=chatgpt.com / perplexity.ai` no analytics.

---

## Próximos passos sugeridos (executáveis em código)
1. Adicionar `SoftwareApplication` JSON-LD na home (apps/web).
2. Criar `apps/web/public/llms.txt`.
3. Ajustar robots.txt para liberar crawlers de IA explicitamente.
4. Criar 2 páginas comparativas (vs Otter / vs Notta) reusando o template de blog.
