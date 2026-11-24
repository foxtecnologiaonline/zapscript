# Balcão Virtual — infraestrutura no Brasil, certificações e resposta a incidentes

Documento **honesto** para a PoC (Pregão 329/2026, TJ-TO). Separa o que é **código/automação entregue e testado** do que é
**contratação, auditoria de terceiros ou decisão do órgão**. Nada aqui afirma uma certificação que a ZapScript/Fox não possui.
Base técnica: `docs/balcao/api-security.md`, `infra/backup/`, `infra/ha/`, `docs/balcao/ARQUITETURA.md`.

## 1. O que é código (feito) × o que é contratação/auditoria

| Requisito do edital | Código/automação (feito) | Depende de contratação/auditoria (não é código) |
|---|---|---|
| Criptografia em trânsito (14.3) | nginx com TLS 1.2/1.3 + HSTS (`infra/ha/nginx/balcao.conf`, template); Postgres exige `hostssl` (`pg_hba.conf.example`); certbot webroot + monitor `tls-expiry.yml` já existentes | Certificados/DNS do ambiente final; TLS entre API e provedores externos (LLM, e-mail) é do provedor |
| Criptografia em repouso, **incluindo backups** (14.3) | AES-256-GCM por campo com chaves versionadas e rotação (mensagens, CPF/CNPJ, TOTP, credenciais, texto de sugestões de IA); `pg-backup.sh`/`storage-backup.sh` sempre cifram (age/openssl) e recusam backup em claro; pgBackRest cifrado (`infra/ha`) | **Disco/volume cifrado** do host e do storage (LUKS/criptografia do provedor): não configurado por este repositório |
| MFA, OpenID, perfis | TOTP, OIDC e RBAC nas frentes `iam`/`integrations`; postura acusa perfis sem MFA | IdP do TJ-TO e política de MFA |
| LGPD (TR 1.1.3.1.14.3) | DSR (acesso/exportação/anonimização/exclusão) + endpoint público com token de uso único; retenção diária com `dryRun`; guarda legal; trilha de auditoria append-only | Encarregado (DPO), RIPD, política de privacidade e base legal por finalidade — **do órgão e da contratada** |
| Logs de operações e acessos (13.1) | `BvAuditLog` imutável (trigger), `auditReq` em leituras sensíveis, consulta pela frente `iam`; retenção mínima `BV_AUDIT_MIN_DAYS` | Envio a SIEM/retenção legal do contrato, se exigido |
| Exportação integral ao fim do contrato (7.1.14.2) | `POST /security/export` (CSV/JSON/XML/SQL, `.tar.gz` com manifest sha256, anexos e gravações, download com `Range` auditado) | Procedimento contratual de entrega/aceite e eliminação posterior |
| Incidente em até 24 h (DPA) | Registro com prazo = ciência + 24 h, lembretes, histórico versionado, alerta na postura | Plantão humano, canal formal com o TJ-TO, avaliação ANPD (art. 48) |
| Alta disponibilidade e réplica geográfica para DR (14.1–14.2) | Templates: 2+ réplicas da API, Redis com Sentinel, Postgres streaming + WAL archiving, runbook (`infra/ha`); replicação/promoção validadas localmente | **Segundo site/zona no Brasil, link privado, bucket S3 no Brasil, DNS com TTL baixo** — não contratados |
| 99,9 % preferencial | Healthchecks, rolling restart, failover documentado | Medição real por ≥ 3 meses e SLA do provedor; **um único servidor hoje não sustenta 99,9 %** |
| 100 % SaaS, data center no Brasil | — | Contratar infraestrutura em região no Brasil (§2) |
| ISO 27001, SOC 2 Type II, ISO 27017 | Controles técnicos alinhados (cifra, auditoria, backup testado, MFA, RBAC) | **Certificados em nome do provedor de nuvem/data center** (e, se exigido, da própria contratada). Código não gera certificação. |

## 2. Residência de dados HOJE — o que precisa mudar

A regra do edital (14.3.2.1; PoC eliminatória 9.1.6.3.2.4) é **dados exclusivamente em território nacional**. A situação documentada no repositório (`CLAUDE.md`, `MIGRACAO_VULTR.md`) e verificada hoje:

| Componente | Situação | Risco p/ residência | O que muda |
|---|---|---|---|
| API/Worker/Redis (Vultr) | Servidor `216.238.120.65`. **Região a confirmar** no painel Vultr (a migração cita São Paulo; não foi possível verificar neste ambiente — sem SSH/painel). | Se for São Paulo, conforme (localização do data center) | Confirmar região e registrar a evidência (print/contrato). Vultr é o provedor; certificações dele devem ser anexadas (pedir à Vultr). |
| Banco Postgres | **Supabase.** Os projetos Supabase visíveis na conta conectada a esta sessão estão em **`us-east-1` (EUA)**; não foi possível identificar qual deles é o da ZapScript. Se o do Balcão estiver lá, **viola** o requisito. | **Alto (eliminatório)** | Para o Balcão, usar Postgres **no Brasil**: (a) self-hosted em região BR (`infra/ha/docker-compose.pg-primary.yml` + standby) ou (b) Supabase/RDS com projeto em `sa-east-1` (confirmar disponibilidade e contrato). Migrar com `infra/backup` (pg_dump/pg_restore). |
| Storage (anexos, gravações) | Disco do servidor Vultr (`BV_STORAGE_DIR`) | Conforme se o servidor for BR | Cópia de backup também em bucket **no Brasil** |
| Backups | Local no servidor; offsite **opcional e não configurado** | Se o bucket externo for fora do Brasil, viola | `BV_BACKUP_UPLOADER` apontando para S3-compatível em região BR, chave de cifra fora do provedor |
| Frontend (Vercel) | Build global/edge. O Balcão (`apps/web/src/app/balcao`) roda no Vercel: HTML/JS estáticos, **mas** requisições de usuário e logs de edge podem passar por POPs fora do Brasil | Médio: o conteúdo de atendimento vem da API; cabeçalhos/IP/URLs podem trafegar | Servir o console do Balcão a partir do próprio nginx no Brasil (build estático) ou provar que nenhum dado pessoal passa pela Vercel; não colocar dados pessoais em URLs |
| E-mail transacional (Resend) | Provedor externo (EUA) usado em `lib/mailer` (inclui o link de verificação de DSR, com e-mail do titular) | Alto: e-mail do titular é dado pessoal | Trocar por SMTP/serviço com processamento no Brasil (o Balcão já tem frente `email` com SMTP configurável por órgão) |
| LLM (OpenAI/Anthropic) | APIs externas; o contexto enviado contém trechos de conversas | **Alto**: transferência internacional de dados pessoais | Opções: (1) modelo hospedado em região BR (provedor com endpoint nacional, ou modelo open-source em GPU no Brasil); (2) desligar IA generativa para o órgão (`settings.ai.enabled=false`; permanece só busca na base); (3) anonimizar antes de enviar (reduz, não elimina, o risco) e declarar no DPA/Anexo G. Sem uma dessas, a IA **não** cumpre residência |
| WhatsApp (Meta Cloud API) | Tráfego passa pela Meta (fora do Brasil por natureza do canal oficial) | Inerente ao canal exigido (TR 1.1.3.1.2.2) | Declarar no DPA como operador/subcontratado do canal; limitar o conteúdo armazenado fora; o mesmo vale para voz/SIP se houver tronco externo |
| Sentry (erros da API) | `@sentry/node` na API | Médio: pode capturar contexto | Configurar região/UE→BR não existe; desativar ou filtrar PII (`beforeSend`) no ambiente do Balcão |
| Evolution/Baileys, Asaas | Produto ZapScript (não do Balcão) | Fora do escopo do Balcão | Manter separado do ambiente do TJ-TO |

`BV_DATA_RESIDENCY=BR` só deve ser declarado depois de todas as linhas acima estarem resolvidas ou formalmente excepcionadas no DPA. O sistema **não consegue provar** localização; a variável é uma atestação do operador exibida na postura.

## 3. DPA / Anexo G — como o produto sustenta cada cláusula

| Cláusula | Sustentação técnica | Lacuna/ação |
|---|---|---|
| Sem transferência internacional | Residência conforme §2 | Resolver Supabase/Resend/LLM/Sentry/Vercel antes da PoC; listar exceções (Meta/WhatsApp) no DPA |
| Subcontratação só com autorização | Lista de suboperadores deste documento (Vultr, provedor de Postgres/bucket, Vercel, e-mail, LLM, Meta) | Manter **registro de suboperadores** versionado e pedir autorização prévia ao TJ-TO a cada inclusão; hoje não há trava técnica |
| Comunicação de incidente ≤ 24 h | `POST /security/incidents` (prazo, lembretes, auditoria) | Plantão e canal formal; teste de mesa semestral |
| Direitos do titular | Módulo DSR (15 dias) | Fluxo de identidade e encarregado |
| Devolução/eliminação ao fim | Exportação integral + `retention` + exclusão; | Eliminação em **backups** ocorre pela rotação (≤ 12 meses por padrão): declarar prazo; certificado de eliminação é procedimento humano |
| Medidas de segurança | Postura (`GET /security/posture`), cifra, MFA, auditoria | Pentest e análise de vulnerabilidades por terceiro (não realizados) |

## 4. Resposta a incidentes (24 h)

1. **T0 = ciência.** Registrar na hora (`POST /balcao/security/incidents`, `awareAt`); o prazo é `awareAt + 24 h`.
2. Conter e preservar evidências (guarda legal `PUT /legal-hold` para suspender retenção/exclusão; não reiniciar nem apagar logs).
3. Classificar (dados afetados, titulares, severidade). Comunicar o TJ-TO **antes das 24 h** com o que se sabe (relatório parcial é aceitável); registrar `notifiedAt/notifiedTo`.
4. Encarregado do órgão decide sobre ANPD/titulares (LGPD art. 48; prazo regulatório próprio).
5. Pós-incidente: causa raiz, medidas, rotação de chaves/credenciais se aplicável (`api-security.md`), encerrar o registro. Guardar o histórico versionado como evidência.
Plantão, telefone/e-mail de contato e responsável nomeado: **a definir no contrato** (não existem hoje).

## 5. Matriz requisito → evidência (PoC 9.1.6.3.2.4 e itens correlatos)

| Requisito | Evidência gerável | Como obter | Estado |
|---|---|---|---|
| Dados em território nacional | Contrato/painel da região do servidor, do Postgres e do bucket; saída de `dig`/`curl ipinfo` do IP; declaração `BV_DATA_RESIDENCY`; DPA com lista de suboperadores | Operador anexa prints do painel dos provedores; `GET /security/posture` (`residency.declared`) | **Pendente** (§2) |
| Criptografia em trânsito | Relatório de TLS (ex.: `testssl.sh`/SSL Labs) do domínio, cabeçalho HSTS, `pg_hba` com `hostssl` | `curl -sI https://<host>/balcao/health`; `testssl.sh` | Config pronta (template); teste real pendente |
| Criptografia em repouso | `GET /security/keys/status` (todos os registros com `kid`, zero `_plain`); posture `crypto.*`; amostra do banco mostrando `bv1.<kid>.…` | CLI `rotate-field-keys --status`; `psql -c "select left(body,12) from \"BvMessage\" limit 3"` | Código testado |
| Backups cifrados | `status.json` (`encrypted:true`, `cipher`), arquivos `.age/.enc` (cabeçalho `age-encryption.org` / `Salted__`), sha256 | `infra/backup/README.md`; posture `backup.last` | Testado localmente |
| Backup restaurável + RTO | Log do `pg-restore-test.sh` (contagens iguais, `rtoSeconds`), `lastRestoreTestOk:true` | Rodar mensalmente no ambiente real e anexar | Testado local (2 s em base de 3 MB); **produção pendente** |
| Logs de operações e acessos | Consulta de auditoria (iam) e `retention.*`/`security.*`; trigger `bv_audit_no_update` | posture `audit.append_only` | Código testado |
| LGPD (titular, retenção) | Relatórios de DSR, `BvRetentionRun`, dry-run da retenção | `/security/dsr`, `/security/retention/runs` | Código testado |
| Exportação ao fim do contrato | `.tar.gz` + `manifest.json` conferido | `POST /security/export` num órgão de teste, `sha256sum` por arquivo | Código testado |
| MFA/OpenID | Perfis com TOTP ativo (posture `mfa.*`), login OIDC | Frentes iam/integrations; IdP do TJ-TO | Código testado; IdP real pendente |
| Alta disponibilidade/DR | Exercício de DR cronometrado (RUNBOOK §6), `check-ha.sh`, replicação ativa | Exige 2º site no Brasil | **Pendente** (templates prontos) |
| Incidente 24 h | Registro de incidente de simulação com `notifiedAt` < 24 h | Teste de mesa | Código testado |
| ISO 27001 / SOC 2 T2 / ISO 27017 | Certificados e relatórios do provedor (e escopo cobrindo o serviço usado) | Solicitar ao provedor/NDA | **Pendente (contratação)** |
| Carga/desempenho | Saída de `apps/api/scripts/balcao-smoke-load.ts` (P50/P95/P99/erros) | Rodar contra homologação | Ferramenta pronta; só medido em dev local |

## 6. RPO/RTO propostos e como testar o DR

| Cenário | RPO proposto | RTO proposto | Mecanismo |
|---|---|---|---|
| Falha de réplica da API/Redis | 0 / ≤ 1 s (AOF everysec) | < 1 min | nginx `max_fails`, Sentinel+HAProxy |
| Falha do Postgres primário (mesmo site) | ≤ 60 s (assíncrono; 0 com `synchronous_standby_names`) | ≤ 15 min (promoção manual) | standby streaming |
| Perda do site/região (DR) | ≤ 5 min de banco; **arquivos: até 24 h** enquanto o storage for disco local sem replicação | ≤ 30 min banco + API; ≤ 4 h storage (restauração do tar) | standby/pgBackRest em outro site + `storage-backup` |
| Corrupção lógica/erro humano | até o ponto escolhido (PITR) | ≤ 2 h | pgBackRest PITR / `pg_dump` diário |

Valores **propostos**, a validar em exercício e a ajustar ao contrato; não são medições de produção.
Como testar: (1) mensal — `pg-restore-test.sh` (grava RTO de decifrar+restaurar+validar); (2) trimestral — exercício completo do `RUNBOOK-failover.md` §6 em ambiente isolado, cronometrando decisão → banco → API → login e conversa de teste; (3) após cada mudança de chaves — restaurar e rodar `rotate-field-keys --status`; (4) anexar logs e tempos à evidência da PoC.

## 7. Plano mínimo para a PoC (ordem sugerida)

1. Confirmar/registrar a região Vultr; decidir Postgres no Brasil e migrar (`infra/backup` + `infra/ha`).
2. Resolver LLM, e-mail (Resend), Sentry e Vercel conforme §2 (ou formalizar exceções com o TJ-TO).
3. Configurar cifra de disco, backup com cópia externa em bucket BR, agendamentos; rodar o restore-test e guardar o log.
4. Subir 2 réplicas + nginx de `infra/ha`; coletar relatório TLS e saída do `balcao-smoke-load`.
5. Contratar 2º site/zona no Brasil e fazer o exercício de DR; solicitar certificações aos provedores; nomear encarregado e plantão de incidentes.
