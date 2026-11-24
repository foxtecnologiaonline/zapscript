#!/bin/bash
# Entrypoint do STANDBY (outra zona/região do Brasil): na primeira subida clona o primário com pg_basebackup (TLS,
# slot bv_standby1) e inicia em recovery contínuo (standby.signal). Nas seguintes só inicia.
#   PRIMARY_HOST, PRIMARY_PORT(5432), REPLICATION_PASSWORD, PGDATA (padrão do contêiner)
set -euo pipefail
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
: "${PRIMARY_HOST:?defina PRIMARY_HOST}" "${REPLICATION_PASSWORD:?defina REPLICATION_PASSWORD}"
PORT="${PRIMARY_PORT:-5432}"

if [ "$(id -u)" = 0 ]; then exec gosu postgres "$0" "$@"; fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[standby] clonando $PRIMARY_HOST:$PORT (pg_basebackup, sslmode=verify-full)"
  mkdir -p "$PGDATA"; chmod 700 "$PGDATA"
  umask 077
  printf '%s:%s:replication:replicator:%s\n' "$PRIMARY_HOST" "$PORT" "$REPLICATION_PASSWORD" > /var/lib/postgresql/.pgpass
  chmod 600 /var/lib/postgresql/.pgpass
  PGPASSFILE=/var/lib/postgresql/.pgpass PGSSLMODE="${PGSSLMODE:-verify-full}" PGSSLROOTCERT="${PGSSLROOTCERT:-/etc/postgresql/tls/ca.crt}" \
    pg_basebackup -h "$PRIMARY_HOST" -p "$PORT" -U replicator -D "$PGDATA" -X stream -S bv_standby1 -c fast -P
  touch "$PGDATA/standby.signal"
  cat >> "$PGDATA/postgresql.auto.conf" <<CONF
primary_conninfo = 'host=$PRIMARY_HOST port=$PORT user=replicator passfile=/var/lib/postgresql/.pgpass sslmode=${PGSSLMODE:-verify-full} sslrootcert=${PGSSLROOTCERT:-/etc/postgresql/tls/ca.crt} application_name=bv_standby1'
primary_slot_name = 'bv_standby1'
restore_command = 'pgbackrest --stanza=bv archive-get %f "%p"'
recovery_target_timeline = 'latest'
CONF
fi
exec postgres -c config_file=/etc/postgresql/postgresql.conf "$@"
