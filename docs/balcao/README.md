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

## Pendências que dependem de decisão ou de terceiros
- Credenciais/homologação: Meta (WhatsApp), TJTO (e-Proc, IdP, VoIP/SIP), GOV.BR, Google Workspace, Jira, provedor de e-mail e LLM.
- Data center no Brasil e certificações ISO 27001 / SOC 2 Type II / ISO 27017; confirmar a região do Supabase/Vultr/Vercel.
- Regras de glosa do IQA e fórmula oficial (há duas: `/ai/stats` e `/reports/iqa`) — confirmar com o fiscal.
- Prazo legal de retenção (padrão provisório de 5 anos), política de TTS/idiomas da URA.
- Deploy: `ops.yml` só conhece `api`/`worker`; Asterisk e a topologia HA exigem ajuste no servidor (ver `infra/`).
