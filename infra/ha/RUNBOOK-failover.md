# Runbook — failover e recuperação de desastre (Balcão Virtual)

Objetivo (propostos; valores finais dependem de contrato — ver `docs/balcao/INFRA-BR-CERTIFICACOES.md`):
**RPO ≤ 5 min** (replicação assíncrona + WAL a cada 60 s) e **RTO ≤ 30 min** para perda do site primário.
Todos os comandos abaixo foram escritos para o servidor (SSH feito **pelo operador**; o sandbox do Claude não alcança o servidor).
Um incidente que afete dados pessoais abre o **relógio de 24 h** do DPA: registrar em `POST /balcao/security/incidents`.

## 0. Antes de agir — classifique

| Sintoma | Provável causa | Ação |
|---|---|---|
| Uma réplica da API fora | processo/contêiner | nada: nginx já a retirou (`max_fails`); `docker compose ... up -d api1`. |
| Redis master fora | processo/VM | Sentinel promove a réplica em ~5–35 s; HAProxy segue. Conferir `scripts/check-ha.sh`. Sem ação manual. |
| Postgres primário fora, host vivo | processo/disco | reiniciar o contêiner; se não subir em 5 min, tratar como §2. |
| Site primário inteiro fora (host/região/rede) | desastre | §2 (promover standby no site de DR) + §3 (DNS). |

## 1. Pré-requisitos (verificados nos exercícios trimestrais)

- Standby em streaming: `PRIMARY_URL=... STANDBY_URL=... scripts/check-ha.sh` → `streaming`, atraso < 16 MB.
- Último backup físico (`pgbackrest --stanza=bv info`) e lógico (`/var/backups/zapscript/status.json`, `lastRestoreTestOk=true`).
- No site de DR: imagens da API/worker construídas (`ops.yml` `deploy` com o SHA em produção), `.env` com **as mesmas** `ENCRYPTION_KEY`, `JWT_SECRET`, `BV_FIELD_KEYS`/`BV_FIELD_KEY_CURRENT` (sem elas as mensagens cifradas não abrem), nginx + certificado válidos para `api.zapscript.me` (certbot webroot).
- Storage de objetos (anexos/gravações) disponível no DR (cópia do `storage-backup.sh` restaurada, ou volume replicado). **Lacuna conhecida:** o storage hoje é disco local — sem replicação contínua, o RPO dos arquivos é o do último `storage-backup.sh` (diário).

## 2. Promover o standby (site de DR)

1. **Decidir e registrar** (quem, quando, motivo). Se o primário ainda responde, ele precisa ser **impedido de aceitar escrita** (fencing) *antes* da promoção — dois primários = perda de dados:
   `docker stop zapscript-pg-primary` (ou desligar a VM / bloquear 5432 no firewall).
2. No standby, anote até onde recebeu (para estimar a perda real de dados):
   ```sh
   docker exec zapscript-pg-standby psql -U postgres -Atc "SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp()"
   ```
   O horário de `pg_last_xact_replay_timestamp()` é o limite do RPO efetivo.
3. Promover:
   ```sh
   docker exec zapscript-pg-standby psql -U postgres -Atc "SELECT pg_promote(wait => true, wait_seconds => 60)"
   docker exec zapscript-pg-standby psql -U postgres -Atc "SELECT pg_is_in_recovery()"   # deve ser f
   ```
   (Medido em teste local: promoção em < 1 s; o grosso do RTO é decisão + DNS + subir a API.)
4. Apontar a aplicação para o novo primário: no `.env` do DR, `DATABASE_URL`/`DIRECT_URL` → standby promovido; subir/recriar a API:
   `docker compose --env-file /opt/zapscript/ha.env -f docker-compose.ha.yml up -d api1 api2 worker redis-master redis-replica sentinel-1 sentinel-2 sentinel-3 redis-proxy`
   A API aplica `prisma migrate deploy` no start (idempotente).
5. Validar (≤ 5 min): `curl -fsS https://<DR>/health`, login de teste, `GET /balcao/security/posture` (sem FAIL crítico), `apps/api/scripts/balcao-smoke-load.ts` curto, uma conversa de teste ponta a ponta no canal webchat.

## 3. Tráfego (DNS)

- `api.zapscript.me` com **TTL baixo (60–300 s)** aponta para o IP do site ativo; no desastre, trocar o registro A para o IP do DR. Frontend (Vercel) não muda.
- Webhooks externos (Meta/WhatsApp, VoIP/SIP do TJTO, Asaas) apontam para o DNS — conferir se o SIP/tronco aceita o IP do DR (pode exigir liberação no lado do TJTO: **dependência externa**).
- Cert TLS: o DR precisa do certificado do mesmo nome; emitir com `certbot certonly --webroot` assim que o DNS apontar, ou manter o certificado sincronizado previamente. Nunca `--standalone`.

## 4. Reconstruir a proteção (depois do incidente)

1. O antigo primário **não volta como primário**. Reconstrua-o como standby do novo: `pg_rewind` (se o WAL permitir) ou limpar o volume e subir `docker-compose.pg-standby.yml` (faz `pg_basebackup` novo).
2. Criar o slot no novo primário: `SELECT pg_create_physical_replication_slot('bv_standby1');` e executar `pgbackrest --stanza=bv stanza-upgrade` + `backup --type=full`.
3. Reabilitar `pg-backup.sh`/`storage-backup.sh` no site ativo e rodar `pg-restore-test.sh`.
4. Retorno ao site original (failback) só em janela planejada, repetindo este procedimento no sentido inverso.

## 5. PITR (corrupção lógica / exclusão acidental — sem desastre)

```sh
docker compose -f docker-compose.pg-standby.yml stop        # NÃO no primário; restaure num host/volume novo
pgbackrest --stanza=bv --type=time "--target=2026-11-20 14:30:00-03" --target-action=promote restore
```
Subir o cluster restaurado em porta separada, exportar o que faltou (`pg_dump -t`) e reinserir no primário. Não substitua o primário sem aprovação do responsável.

## 6. Exercício de DR (trimestral) — registrar o resultado

1. Subir o DR a partir **só** dos backups (`pgbackrest restore` + `storage-backup` restaurado), sem tocar na produção.
2. Cronometrar: T0 (decisão) → banco promovido/restaurado → API saudável → login + fluxo de conversa OK = **RTO medido**. `RPO medido` = diferença entre o último dado conhecido e o último dado presente.
3. Registrar data, tempos, falhas e correções (anexar à evidência da PoC/contrato). Atualizar `rtoSeconds` não é automático para o exercício completo (o `pg-restore-test.sh` mede só decifrar+restaurar+validar).
