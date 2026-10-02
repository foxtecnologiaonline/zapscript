# ZapScript × Twilio

> Análise de 2026-10-02. Resumo executivo — leitura em 3 minutos.

## Veredito

Categorias diferentes. Twilio é CPaaS horizontal (primitivas + código); ZapScript é SaaS
vertical de WhatsApp pra PME brasileira (produto pronto). Twilio não é concorrente direto —
é camada que o ZapScript **pode consumir ou substituir**. Concorrentes reais: Take Blip,
Zenvia, Sleekflow, ManyChat.

**Já existe código Twilio no repo:** `routes/twilio-webhook.ts` + `worker/services/twilio.ts`,
registrado em `index.ts:354`, `source: 'whatsapp-twilio'`. Caminho completo inbound → transcrição
→ resposta. Dormente (sem `TWILIO_*` no `.env.example`).

## Comparativo

| | ZapScript | Twilio |
|---|---|---|
| Entrega | Produto pronto, zero código | API/SDK, exige time de dev |
| Canais | WhatsApp (Meta Cloud API, Evolution, Twilio BSP) | SMS, RCS, WhatsApp, Voz, Vídeo, E-mail, Messenger, Push |
| Cobrança | Assinatura BRL, Asaas, PIX | Pay-as-you-go USD (~US$0,005/msg + taxas Meta) |
| Público | MEI/PME, dono do negócio | Engenharia / enterprise |
| SLA | Nenhum (servidor único) | 99,95%+ |

## ZapScript — fortes

- **Produto, não primitiva.** Conecta número → transcrição, Atende, CRM, Campanhas, Cobrança.
- **Canal Evolution.** Número pessoal, sem WABA, sem template. Twilio **não pode replicar** — é
  estruturalmente impossível pra BSP oficial. Diferencial mais defensável.
- **IA resiliente.** Cadeia Anthropic → OpenAI → Groq → Gemini (`ai-fallback.ts`) com kill-switch
  por env. Atende com gate de confiança (80/60/40) que escala em vez de inventar.
- **Compliance opinativo em Campanhas.** Circuit breaker, pool round-robin, aquecimento,
  janela de envio, envio de teste, validação de variáveis, opt-in auditado, leitura real de
  `quality_rating`/`messaging_limit_tier`.
- **Campanhas maduras.** A/B test, drip (passo = Campanha filha), status por `wamid`.
- **Brasil nativo.** PT-BR, LGPD, PIX, afiliados, carteira, proração.
- **Segurança sólida.** HMAC timing-safe, anti-SSRF com DNS, criptografia em repouso, TOTP,
  RBAC de time, rate limit no Redis, DLQ com replay idempotente.

## ZapScript — fracos

| Fraqueza | Evidência |
|---|---|
| SPOF total | API+Worker+Redis+Evolution num único Vultr. Sem HA, sem SLA |
| Deploy manual | API/Worker dependem de `ops.yml` à mão |
| Não é integrável | API pública **só leitura**: `/me`, `/conversations`, `/contacts`. Sem envio |
| Webhooks de brinquedo | 1 URL, **1 evento**, fire-and-forget (`.catch(() => null)`), sem retry, sem log |
| Risco de ToS | Evolution é não oficial — risco de ban do número do cliente |
| Erros não normalizados | `errorMessage` texto livre cortado em 500 chars |
| Observabilidade ausente | `CAMPANHAS_ARQUITETURA.md` §5: *"Nenhuma dessas métricas existe hoje"* |
| Superfície espalhada | 13 módulos, maioria `planned`/`discovery`; 50+ `.md` na raiz |
| Mono-canal | Multicanal desenhado (§13 `ChannelAdapter`) mas em `discovery` |

## Twilio — fortes e fracos

**Fortes:** omnicanal; ~180 países com provisionamento/portabilidade; Content Template Builder
(cria e submete template → Content SID); Messaging Services (pool, sticky sender, geomatch,
agendamento); status callback granular (`accepted → queued → sending → sent → delivered →
read/failed`); `I-Twilio-Idempotency-Token`; subcontas; Debugger + Event Streams; SDKs em 7
linguagens; Verify, Lookup, Studio, Flex, Segment; SOC 2 / HIPAA / GDPR; 2026 traz console e
SDK unificados (Agent Connect, Conversation Orchestrator/Memory/Intelligence).

**Fracos:** nada funciona sem código; custo composto e imprevisível (taxa Twilio + Meta;
marketing BR ~US$0,0625/msg); nenhuma vertical pronta (sem CRM, cobrança, transcrição); zero
PT-BR/LGPD/PIX; obriga WABA formal; IA recém-nascida frente à do ZapScript.

## O que falta ao ZapScript

### P0 — necessário

1. **API de escrita.** `POST /messages`, `/campanhas`, `/contacts`. Sem isso não existe
   Zapier/Make/n8n nem integração com ERP, e o tier Empresas não se sustenta. Maior gap único.
2. **Eventos de verdade.** Múltiplos eventos (`message.received`, `delivery.status`,
   `conversation.escalated`, `campaign.completed`, `contact.optout`), múltiplos endpoints,
   retry com backoff, log de entrega. **Reuso de BullMQ+DLQ, não construção nova.**
3. **`Idempotency-Key` nas rotas de escrita.** Pré-requisito do item 1 — sem isso, retry de
   cliente duplica mensagem e queima o número.

### P1 — alto retorno

4. **Criação de template in-app.** Adiado em §6.3, mas é a maior fricção de onboarding do canal
   Meta. `listTemplates` já fala com `/{waba}/message_templates` — criar é o mesmo em `POST`.
5. **Log de mensagens pro usuário** (tipo Debugger). DLQ existe mas é só admin em `/sys/g5r8t2`.
6. **Códigos de erro normalizados.** Enum estável + doc. Barato, melhora suporte na hora.
7. **Métricas do próprio §5:** taxa de entrega, `quality_rating` no tempo, % do tier diário.
8. **Header de mídia em template** (imagem/vídeo/doc). Já no backlog da matriz §2.

### P2 — avaliar antes

9. **Multicanal** (Instagram, Messenger, Telegram). Gatilho = demanda validada, não paridade.
10. **Sandbox / isolamento tipo subconta.** Obrigatório assim que houver API de escrita.
11. **SDKs oficiais.** Prematuro antes do item 1.

### Não copiar

SMS, Voz, Vídeo, cobertura global, Flex, Segment, Verify/OTP — outro negócio, outra margem.
**Studio** (flow builder) também não: a resposta do ZapScript é IA-first via Atende, e pra PME
isso é melhor que fluxograma.

## Conclusão

Ganha onde escolheu competir: produto pronto, PT-BR, PIX, IA embutida, canal Evolution
irreplicável. Perde em três eixos:

1. **Confiabilidade** (SPOF, deploy manual) — infra, custa dinheiro, sem atalho.
2. **Plataforma pra dev** (sem API de escrita, sem webhooks, sem idempotência) — é o P0,
   e reusa BullMQ/DLQ/ApiKey já existentes.
3. **Observabilidade** — o time já sabe o que medir; falta instrumentar.

**Melhor retorno: o eixo 2.** Converte o tier Empresas de promessa em produto e não exige
nenhuma infra nova.

## Fontes

- [Twilio Products](https://twilio.com/API)
- [Twilio WhatsApp — Key Concepts](https://static0.twilio.com/docs/whatsapp/key-concepts)
- [Twilio WhatsApp Pricing](https://static0.twilio.com/en-us/whatsapp/pricing)
- [Twilio Programmable Messaging](https://static0.twilio.com/docs/sms)
- [Twilio Webhooks — Best Practices](https://hookdeck.com/webhooks/platforms/twilio-webhooks-features-and-best-practices-guide)
- [WhatsApp Business API Pricing 2026](https://chatmaxima.com/blog/?p=3468)
