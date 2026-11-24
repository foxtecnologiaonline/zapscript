# Balcão Virtual — variáveis de ambiente

Todas opcionais, exceto as marcadas **(obrigatória em produção)**. As variáveis comuns do ZapScript (`DATABASE_URL`, `REDIS_URL`,
`JWT_SECRET`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`…) continuam valendo. Vivem no `.env` do servidor (ver CLAUDE.md), nunca no GitHub.

## Núcleo e segurança
| Variável | Padrão | Para quê |
|---|---|---|
| `BV_FIELD_KEYS` | — | JSON `{"1":"<64 hex>","2":"<64 hex>"}` com as chaves de cifragem de campo (mensagens, credenciais, TOTP). Sem ela, deriva de `ENCRYPTION_KEY`. **Recomendada em produção** (permite rotação) |
| `BV_FIELD_KEY_CURRENT` | maior id de `BV_FIELD_KEYS` | Id da chave usada para cifrar novos dados |
| `BV_STORAGE_DIR` | `/var/lib/zapscript/bv-storage` | Raiz do armazenamento de anexos/gravações/exportações. **Volume Docker na região Brasil (obrigatória em produção)** |
| `BV_JOBS` | ligado | `off` desliga os jobs periódicos |
| `BV_PUBLIC_API_URL` | — | URL pública da API (webhooks/callbacks mostrados no admin) |
| `BV_DEV_SIMULATORS` | — | `1` habilita simuladores de WhatsApp/e-mail/voz. **Nunca em produção** |
| `BV_AUDIT_MIN_DAYS` | 365 | Piso de retenção da trilha de auditoria |
| `BV_BACKUP_STATUS_FILE` | — | JSON gravado pelos scripts de backup (alimenta `/security/posture`) |
| `BV_DSR_VERIFY_TTL_SEC` | 3600 | Validade do token de verificação do pedido público de titular |

## Autenticação (iam)
`BV_LOGIN_RL_MAX` (20) · `BV_LOGIN_RL_WINDOW_SEC` (600) · `BV_LOGIN_MAX_FAILS` (5) · `BV_LOGIN_LOCK_MIN` (15). CLIs: `BV_ADMIN_PASSWORD`, `BV_DEMO_PASSWORD`.

## Roteamento
`BV_ROUTING_SWEEP_MS` (15000) · `BV_ROUTING_SWEEP_BATCH` · `BV_ROUTING_TIMEOUT_HOURS` (24; 0 desliga) · `BV_ROUTING_OVERFLOW_BOOST`. Também por órgão em `settings.routing`.

## Webchat
`BV_JITSI_BASE_URL` (https://meet.jit.si) · `BV_WEBCHAT_ENFORCE_ORIGIN` · `BV_WEBCHAT_DEMO` · `BV_WEBCHAT_SESSION_TTL_SEC` · `BV_WEBCHAT_MAX_MESSAGE_CHARS` · `BV_WEBCHAT_MAX_ATTACHMENT_MB` · `BV_WEBCHAT_RL_SESSIONS|MSG|ATTACH`. Web: `NEXT_PUBLIC_BV_JITSI_ORIGIN` (CSP), `NEXT_PUBLIC_BV_ORG_SLUG` (login pelo IdP).

## Voz
| Variável | Para quê |
|---|---|
| `BV_VOICE_ENABLED` | `1` liga o controlador ARI no processo da API |
| `BV_ARI_URL`, `BV_ARI_USER`, `BV_ARI_PASS`, `BV_ARI_APP` | Acesso ao Asterisk (ARI) |
| `BV_SIP_SECRET` | Segredo da derivação das senhas SIP dos ramais (HMAC). **Obrigatória para o softphone** |
| `BV_SIP_DOMAIN`, `BV_ICE_SERVERS` | Domínio SIP/WSS e servidores STUN/TURN (JSON) |
| `BV_AGENT_EXT_START/END`, `BV_AGENT_RING_SEC` | Faixa de ramais e tempo de toque |
| `BV_VOICE_ORG_ID`, `BV_VOICE_MAX_QUEUE_SEC` | Órgão padrão do tronco (instalação de órgão único) e espera máxima |
| `BV_ASTERISK_RECORDING_DIR`, `BV_ASTERISK_RECORDING_KEEP`, `BV_ASTERISK_SOUNDS_DIR` | Volumes compartilhados com o Asterisk |
| `BV_TTS_ENABLED`, `BV_TTS_API_KEY`, `BV_TTS_MODEL`, `BV_TTS_VOICE` | Prompts da URA por TTS (opcional) |
Detalhes e variáveis do container Asterisk: `infra/asterisk/README.md`.

## IA
`BV_LLM_MODEL_FAST` · `BV_LLM_MODEL_STRONG` (só curadoria) · `BV_LLM_DISABLED` · `BV_AI_AUTOSTART` · `BV_AI_TOPK` · `BV_AI_IDLE_MINUTES` · `BV_AI_STALL_MINUTES` · `BV_AI_CURATION_DAYS` · `BV_AI_CURATION_MIN_PER_ARTICLE|SUGGESTION`.

## Relatórios e fiscal
`BV_REPORTS_REALTIME_MS` · `BV_REPORT_ALLOWED_DOMAINS` (domínios de e-mail permitidos para relatórios agendados) · `BV_STORAGE_SCAN_MAX`.

## Integrações
`BV_INT_RL_FORCE` (testes). Credenciais de e-Proc/GOV.BR/IdP/Google/Jira/WhatsApp/e-mail ficam cifradas no banco (`BvIntegration`), configuradas pelo painel — não por variável de ambiente.
