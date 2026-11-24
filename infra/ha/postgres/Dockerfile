# PostgreSQL + pgBackRest (backup físico cifrado, arquivamento de WAL e PITR para armazenamento S3-compatível no Brasil).
ARG PG_MAJOR=16
FROM postgres:${PG_MAJOR}
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY pgbackrest.conf.example /etc/pgbackrest/pgbackrest.conf
COPY init-replication.sh /docker-entrypoint-initdb.d/10-init-replication.sh
COPY standby-entrypoint.sh /usr/local/bin/standby-entrypoint.sh
RUN chmod 0755 /docker-entrypoint-initdb.d/10-init-replication.sh /usr/local/bin/standby-entrypoint.sh \
 && mkdir -p /var/lib/pgbackrest /var/spool/pgbackrest /var/log/pgbackrest \
 && chown -R postgres:postgres /var/lib/pgbackrest /var/spool/pgbackrest /var/log/pgbackrest /etc/pgbackrest
