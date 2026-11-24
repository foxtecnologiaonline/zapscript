#!/bin/bash
# Executa UMA vez na criação do cluster primário (docker-entrypoint-initdb.d): cria o papel de replicação, o usuário
# somente-leitura de backup e o slot físico do standby. Senhas vêm do ambiente (nunca do repositório).
set -euo pipefail
: "${REPLICATION_PASSWORD:?defina REPLICATION_PASSWORD}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD}';
SELECT pg_create_physical_replication_slot('bv_standby1');
SQL
if [ -n "${BACKUP_RO_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE backup_ro WITH LOGIN PASSWORD '${BACKUP_RO_PASSWORD}';
GRANT pg_read_all_data TO backup_ro;
SQL
fi
