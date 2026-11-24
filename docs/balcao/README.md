# Balcão Virtual (omnichannel) — como rodar, demonstrar e o que falta

Plataforma de atendimento omnichannel com IA para o Balcão Virtual (Pregão 329/2026 — TJ-TO), construída dentro do monorepo ZapScript.
Arquitetura e decisões: [ARQUITETURA.md](ARQUITETURA.md). Variáveis: [ENV.md](ENV.md). Uso do Tiledesk: [TILEDESK.md](TILEDESK.md).
Infra e certificações (o que é código e o que é contratação): [INFRA-BR-CERTIFICACOES.md](INFRA-BR-CERTIFICACOES.md).

## Subir localmente
```bash
pnpm install --frozen-lockfile && pnpm --filter database generate
export DATABASE_URL=… DIRECT_URL=… REDIS_URL=redis://localhost:6379 JWT_SECRET=… ENCRYPTION_KEY=<64 hex>
pnpm --filter database exec prisma migrate deploy          # cria as tabelas Bv*
cd apps/api && BV_DEMO_PASSWORD='DemoSenha12345' npx ts-node src/balcao/cli/seed-demo.ts   # órgão demo
NODE_ENV=development PORT=3001 BV_DEV_SIMULATORS=1 npx ts-node src/index.ts                  # API
cd ../web && NEXT_PUBLIC_API_URL=http://localhost:3001 npx next dev -p 3000                  # console em /balcao/login
```
Usuários demo (`orgSlug` = `demo`): `admin|supervisor|atendente1..3|fiscal@demo.balcao.local`. Órgão real: `src/balcao/cli/create-org.ts`.

## Roteiro de demonstração (PoC)
1. **Atendente** (`/balcao/atendimento`): ficar *Disponível*; injetar uma conversa com `POST /balcao/whatsapp/dev/simulate-inbound`
   (ou o widget em `/balcao/webchat/demo?org=demo`, ou e-mail/voz simulados). Bot → escalonamento → roteamento → conversa aparece; responder, transferir, criar tarefa, consultar processo (e-Proc), buscar na base.
2. **Supervisor** (`/balcao/supervisor`): filas, agentes, SLA, assumir/atribuir. **Relatórios** e **Painel do fiscal** (consumo × cota, projeção, IQA).
3. **Admin**: usuários (cadastro em massa), filas/regras, URA (editor + simulador + publicar), curadoria (fila de revisão, sugestões, teste do bot), integrações, auditoria, segurança/LGPD.
4. Acessibilidade: A−/A+, alto contraste, Libras (VLibras), navegação por teclado; widget com Shadow DOM acessível.
Teste automatizado do fluxo no navegador: `apps/api/scripts/balcao-e2e-smoke.js` (Playwright; ver cabeçalho do arquivo).

## Testes
`cd apps/api && npx jest --runInBand src/balcao` (21+ suítes, mais de 450 testes) · `cd apps/web && npx tsc --noEmit && npx next build`.

## Matriz requisito → onde está → verificação
| Requisito do edital | Onde | Verificado |
|---|---|---|
| Plataforma web única, perfis atendente/supervisor | `apps/web/src/app/balcao`, `iam` | Navegador (Playwright) |
| WhatsApp oficial (broker, itens 7–9) | `channels/whatsapp` | Servidor Graph falso; **não** com a Meta real |
| Chat/popup no site | `channels/webchat` | API/socket testados; widget **não** testado em leitor de tela |
| E-mail | `channels/email` | Fakes de IMAP/SMTP; **não** com servidor real |
| Voz nativa, URA, gravação 100%, SIP/transbordo | `channels/voice`, `infra/asterisk` | ARI falso; **não** com Asterisk/tronco reais |
| Roteamento e filas | `routing` | Testes + navegador |
| IA (chatbot) e **curadoria** | `ai` | LLM falso; **não** com LLM real |
| Tarefas internas / service desk / ISA | `tasks` | Testes |
| e-Proc, GOV.BR (ouro), IdP TJTO, Google, Jira | `integrations` | Servidores falsos; **não** com os sistemas reais |
| Painel do fiscal, cotas, relatórios, IQA | `reports` | Testes + navegador |
| LGPD, retenção, criptografia, exportação final, backup/DR | `security`, `infra/backup`, `infra/ha` | Backup→restore e replicação testados localmente; HA/nginx/pgBackRest **não** |
| Acessibilidade eMAG/WCAG, Libras | `_ui`, `lib/balcao/a11y.tsx`, widget | Estático; **falta auditoria com leitor de tela** |

## Evidências de verificação (24/11/2026, ambiente local)
| Verificação | Resultado |
|---|---|
| API (`jest --runInBand`) | 73 suítes, **1192 testes** passando (inclui os testes antigos do ZapScript) |
| Web (`jest`) e `tsc` api/worker/web, `next build` | passando |
| Fluxo no navegador (`scripts/balcao-e2e-smoke.js`) | **23/23**: WhatsApp simulado → bot → roteamento → console → resposta; 15 telas sem erro de console/rede |
| Acessibilidade automática (axe-core, WCAG 2.1 A/AA) | **0 violações** em 17 telas, 5 telas em alto contraste e no widget (fechado e aberto). Não substitui teste com leitor de tela |
| Carga (`scripts/balcao-smoke-load.ts`, API em modo produção, 1 nó de sandbox) | lista de conversas autenticada, 250 conexões simultâneas: 0% de erro, ~1.050 req/s, P95 271 ms. Indicativo — não representa produção |
| Limitador | por usuário no `/balcao` (600/min), por IP no resto; 429 correto; webhooks e `/health` isentos |
| Regressão do site público | páginas do ZapScript inalteradas (widget de suporte, JSON-LD, CSP) |
| Backup→restauração (age/openssl) e replicação/promoção do Postgres | testados localmente; HA completa (nginx/HAProxy/Sentinel/pgBackRest) **não** |

## Pendências que dependem de decisão ou de terceiros
- Credenciais/homologação: Meta (WhatsApp), TJTO (e-Proc, IdP, VoIP/SIP), GOV.BR, Google Workspace, Jira, provedor de e-mail e LLM — todas as integrações só foram testadas contra servidores simulados.
- Asterisk: construir a imagem, carregar os `.conf` e testar tronco/WebRTC/gravação reais (nada disso rodou).
- Teste de acessibilidade com leitor de tela (NVDA/JAWS/VoiceOver), teclado e zoom por pessoas; legendas ao vivo dependem de `SpeechRecognition` (Chrome/Edge).
- Teste de carga representativo (250 atendentes + 40 supervisores, até 1.200 simultâneos citados no ETP) em ambiente igual ao de produção.
- Data center no Brasil e certificações ISO 27001 / SOC 2 Type II / ISO 27017; confirmar a região do Supabase/Vultr/Vercel/Resend.
- Decisões comerciais: base do IQA (padrão `ALL_BOT`, configurável) e faixas de glosa; prazo legal de retenção (padrão provisório de 5 anos); valor da proposta (TR × ETP) e escopo do item 11.
- Operação: treinamento (120 h/ano), 24/7 e a curadoria como serviço (40 h/mês) não são software.
- Deploy: `ops.yml` só conhece `api`/`worker`; Asterisk, ClamAV (`BV_CLAMAV_HOST`) e a topologia HA exigem ajuste no servidor. Aplicar as migrations `20261123_*`/`20261124_*` e definir as variáveis `BV_*` (ver ENV.md). Merge em `master` dispara deploy do web na Vercel.
- Limitações conhecidas: storage em disco local sem replicação multi-host; um único nó controla o ARI (líder por lock Redis); PII por heurística (sem NER); `findMany` sem paginação em alguns jobs (aviso do teto de 5000 linhas aparece em bases de teste muito grandes).
