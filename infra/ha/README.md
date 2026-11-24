# infra/ha — alta disponibilidade e DR do Balcão Virtual (região Brasil)

Templates (não ativados em produção): nada aqui roda sozinho. A produção atual é **um servidor Vultr** com Docker Compose
(`/root/docker-compose.zapscript.yml`, deploy manual via `ops.yml`). Esta pasta descreve e entrega os arquivos para evoluir
para o requisito do edital (TR 14.1–14.2: alta disponibilidade multi-zona, réplica geográfica para DR, 99,9 % preferencial).
**O que é código está pronto; o que é contratação (segundo site/zona no Brasil, bucket S3 no Brasil, rede privada) está em
`docs/balcao/INFRA-BR-CERTIFICACOES.md`.**

## Topologia

```
                   DNS api.zapscript.me (TTL 60–300 s)
                              │
        ┌─────────────────────┴───────────────────────┐
        │ SITE PRIMÁRIO (Brasil, zona A)              │   SITE DR (Brasil, outra zona/região)
        │  nginx do host (TLS 1.2/1.3, HSTS, limites) │    mesma stack, parada/quente
        │   ├─ api1 :3001 ┐                           │    ├─ api1/api2/worker (imagens iguais)
        │   └─ api2 :3002 ┴─ Socket.IO + adapter Redis│    ├─ Redis + Sentinel (opcional)
        │  worker                                     │    └─ Postgres STANDBY (hot, streaming)
        │  Redis master + réplica + 3 sentinelas      │            ▲
        │  HAProxy (→ master)                         │            │ WAL streaming (TLS, slot) + WAL archive
        │  Postgres PRIMÁRIO ─────────────────────────┼────────────┘
        │  /var/backups (pg_dump cifrado) ───────────────► bucket S3 no Brasil (cifrado no cliente)
        └─────────────────────────────────────────────┘
```

## Arquivos

| Arquivo | Para quê |
|---|---|
| `nginx/balcao.conf` | upstreams (least_conn; hash por IP p/ Socket.IO), TLS, HSTS, limites, timeouts de WebSocket e de download |
| `docker-compose.ha.yml` + `env.ha.example` | `api1`/`api2`, `worker`, Redis master/réplica + Sentinel + HAProxy |
| `redis/redis.conf`, `haproxy/redis-master.cfg` | AOF everysec, `noeviction` (BullMQ), roteamento ao master |
| `docker-compose.pg-primary.yml` / `docker-compose.pg-standby.yml` | Postgres primário e standby (outra zona/região) |
| `postgres/` | `Dockerfile` (Postgres+pgBackRest), `postgresql.conf.example`, `pg_hba.conf.example`, `pgbackrest.conf.example`, `init-replication.sh`, `standby-entrypoint.sh` |
| `scripts/rolling-restart.sh` | deploy sem indisponibilidade (uma réplica por vez) |
| `scripts/check-ha.sh` | health das réplicas, Redis e atraso de replicação |
| `RUNBOOK-failover.md` | promoção do standby, DNS, reconstrução, PITR, exercício de DR |

## Como cada requisito é atendido (e o que falta)

| Requisito | Entrega | Estado |
|---|---|---|
| 2+ réplicas da API | `api1`/`api2` + nginx; jobs usam lock Redis (`registerJob`) → sem duplicidade; Socket.IO com adapter Redis | Template; `docker compose config` validado, **não subido** neste ambiente |
| Sticky p/ Socket.IO | `hash $binary_remote_addr consistent` (ou clientes só-WebSocket) | Template (nginx não testado: sem nginx/daemon Docker no sandbox) |
| TLS/HSTS | `balcao.conf`; certbot webroot | Template |
| Redis HA | master+réplica+Sentinel+HAProxy; `noeviction` | Template. A API fala com 1 endpoint (`REDIS_URL`); sem suporte nativo a Sentinel no cliente — por isso o HAProxy |
| Postgres streaming + WAL archiving | `postgresql.conf.example`, `pg_hba`, pgBackRest cifrado em S3 | Replicação e promoção **validadas localmente** (primário+standby+promote em ~250 ms, parâmetros equivalentes, sem TLS/pgBackRest); resto template |
| Failover | **manual** (runbook). Automático exigiria Patroni/repmgr + 3º nó de quórum | Decisão consciente: evita split-brain sem quórum |
| Multi-zona real | exige 2º site/zona **no Brasil** (contratação) | **Não entregue** — ver INFRA-BR-CERTIFICACOES.md |

## Limitações que precisam ser resolvidas antes de ligar multi-host

1. **Storage de objetos em disco local** (`BV_STORAGE_DIR`): duas réplicas no MESMO host compartilham o volume; entre hosts/zonas é preciso
   (a) trocar `core/storage.ts` por S3-compatível no Brasil (a interface já foi desenhada para isso — mudança fora desta frente) ou
   (b) volume de rede/replicado. Sem isso, o DR perde os arquivos criados depois do último `storage-backup.sh`.
2. **Conexões longas por instância**: o e-mail (IMAP) usa job com lock Redis (ok com N réplicas), mas a voz (`channels/voice`, `startVoice` via
   `onBalcaoStart`) abre a conexão ARI em **cada** réplica — o Asterisk entregaria os mesmos eventos a todas (chamadas tratadas em duplicidade).
   Não verificado; até a frente `voice` ter exclusão mútua (lock Redis), rode a voz numa réplica dedicada ou mantenha 1 réplica ativa nesse tenant.
3. `ops.yml` só conhece os serviços `api`/`worker` — ajustar para `api1/api2` (ou usar `rolling-restart.sh`).
4. Dependência externa: o tronco SIP do TJTO e os webhooks da Meta precisam aceitar o IP do site de DR.
