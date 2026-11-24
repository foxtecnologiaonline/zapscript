# infra/backup — backup cifrado e teste de restauração (Balcão Virtual)

Requisito do edital: criptografia em repouso **incluindo backups** (TR 1.1.3.1.14.3), dados só em território nacional e
DR. Estes scripts geram backups **sempre cifrados** (um backup em claro é recusado), com checksum, rotação, cópia externa
opcional e um JSON de status que a API lê (`GET /balcao/security/posture`).

| Script | O que faz |
|---|---|
| `pg-backup.sh` | `pg_dump -Fc` → **age** (chave pública) ou **openssl AES-256-CBC + PBKDF2 600k** → `.age`/`.enc` + `.sha256` + `.meta.json` (contagens e última migration); verificação pós-backup; rotação diária/semanal/mensal; upload `aws`/`rclone`. |
| `storage-backup.sh` | `tar.gz` cifrado do `BV_STORAGE_DIR` (anexos e gravações; sem `tmp/` e sem `exports/`). |
| `pg-restore-test.sh` | restaura o último backup num banco **temporário**, confere sha256, contagens e migrations, mede e registra o **RTO** (`rtoSeconds`) e apaga o banco. |
| `scheduler.sh`, `Dockerfile.backup`, `docker-compose.backup.yml` | execução em contêiner (agendador diário; profile `restore-test` com Postgres descartável). |
| `crontab.example`, `systemd/*` | alternativas de agendamento no host. |
| `backup.env.example` | todas as variáveis (copiar para `/etc/zapscript/backup.env`, modo 600). |

## Chaves — a parte que mais importa

- **age (recomendado)**: `age-keygen -o age-identity.key`. No servidor fica **só a chave pública** (`BV_BACKUP_AGE_RECIPIENT`); quem consegue ler o servidor
  não consegue abrir os backups. A chave privada fica **offline** com o responsável (cofre/HSM/duas pessoas) e só aparece no host de restauração.
- **openssl**: `openssl rand -base64 48 > /etc/zapscript/backup/backup.key; chmod 600`. O script **recusa** chave com permissão aberta, < 32 bytes ou dentro do repositório.
  Atenção: AES-CBC não é autenticado — por isso há `sha256` do arquivo cifrado (conferido antes de restaurar) e a verificação pós-backup. Prefira age (ChaCha20-Poly1305 autenticado).
- **Os backups só abrem com TRÊS segredos guardados fora do servidor, em local independente**: (1) chave de backup acima, (2) `ENCRYPTION_KEY`, (3) `BV_FIELD_KEYS`/`BV_FIELD_KEY_CURRENT`
  (as mensagens, CPF/CNPJ, TOTP e credenciais de integração continuam cifrados *dentro* do dump). Sem (2)/(3) a base restaurada é ilegível. **Não rotacione/aposente uma chave de campo (`BV_FIELD_KEYS`) enquanto existir backup que a use** — mantenha o histórico completo de chaves no cofre.

## Instalação (servidor Vultr — produção é um único host com Docker Compose)

```sh
# 1. no servidor (SSH feito pelo operador)
mkdir -p /etc/zapscript/backup /var/backups/zapscript && chmod 700 /etc/zapscript/backup
cp infra/backup/backup.env.example /etc/zapscript/backup.env && chmod 600 /etc/zapscript/backup.env   # preencher
# 2a. cron no host:   cp infra/backup/crontab.example /etc/cron.d/zapscript-backup
# 2b. ou systemd:     cp infra/backup/systemd/* /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now zapscript-pg-backup.timer zapscript-storage-backup.timer zapscript-restore-test.timer
# 2c. ou contêiner:   docker compose -f infra/backup/docker-compose.backup.yml up -d --build backup
# 3. na API (.env do servidor): BV_BACKUP_STATUS_FILE=/var/backups/zapscript/status.json  e montar /var/backups/zapscript:ro no contêiner da API
# 4. primeira execução manual + prova:
set -a; . /etc/zapscript/backup.env; set +a
infra/backup/pg-backup.sh && infra/backup/storage-backup.sh
docker compose -f infra/backup/docker-compose.backup.yml --profile restore-test run --rm restore-test
```

`BV_PG_URL` deve usar um papel **somente leitura** (`GRANT pg_read_all_data`). O pg_dump precisa ser da mesma versão major (ou maior) que o servidor: ajuste `BV_PG_MAJOR`.
Parâmetros Prisma da URL (`schema=`, `pgbouncer=`) são ignorados; `sslmode` é respeitado. A senha não aparece em `ps` (vai por variáveis `PG*`).

## Política

- Retenção local: 7 diários, 4 semanais (domingo, `BV_BACKUP_WEEKLY_DOW`), 12 mensais (dia 1) — `BV_BACKUP_KEEP_*`. Ajuste ao contrato/LGPD: o backup retém dados que a retenção/DSR já removeu da base até expirar a rotação (documentar no RIPD; exclusão de titular **não** reescreve backups antigos — padrão aceito se o backup expira e for restaurado reaplicando DSRs pendentes).
- **Cópia externa obrigatória para DR**: `BV_BACKUP_UPLOADER=aws|rclone` para um bucket S3-compatível **em região no Brasil**, em conta/credencial distinta do servidor: credencial só de escrita, **Object Lock/versionamento** e regra de ciclo de vida (o script não apaga no destino). Sem upload o status mostra `offsite:false` e o posture avisa.
- Backups físicos contínuos (PITR) e WAL archiving: `infra/ha/postgres` (pgBackRest cifrado). O `pg_dump` aqui complementa (portável, restaura em qualquer Postgres; serve de exportação).
- O backup do **storage** é completo diário (sem incremental). Para volumes grandes, trocar por storage S3 versionado no Brasil.
- Restaure banco e storage **do mesmo dia** (mensagens referenciam arquivos por chave).

## Restauração (produção)

```sh
set -a; . /etc/zapscript/backup.env; set +a
export BV_BACKUP_AGE_IDENTITY_FILE=/caminho/offline/age-identity.key     # ou BV_BACKUP_KEY_FILE (openssl)
F=/var/backups/zapscript/postgres/daily/zapscript-pg-AAAAMMDDTHHMMSSZ.dump.age
( cd "$(dirname "$F")" && sha256sum -c "$(basename "$F").sha256" )
createdb -h NOVO_HOST -U admin zapscript_restaurado
age -d -i "$BV_BACKUP_AGE_IDENTITY_FILE" "$F" > /tmp/restore.dump          # openssl: openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:$BV_BACKUP_KEY_FILE -in "$F" > ...
pg_restore -h NOVO_HOST -U admin -d zapscript_restaurado --no-owner --no-acl -j 4 /tmp/restore.dump && shred -u /tmp/restore.dump
# storage:
age -d -i "$BV_BACKUP_AGE_IDENTITY_FILE" .../storage/daily/zapscript-storage-*.tar.gz.age | tar -xzf - -C /var/lib/zapscript/bv-storage
# conferir: subir a API com DATABASE_URL/DIRECT_URL apontando para o banco restaurado e rodar
node apps/api/dist/balcao/security/cli/rotate-field-keys.js --status      # contagens por kid; erro de chave = faltam BV_FIELD_KEYS
```

Depois: `GET /balcao/security/posture` e uma conversa de teste. Runbook completo de DR: `infra/ha/RUNBOOK-failover.md`.

## Status gravado (`BV_BACKUP_STATUS_FILE`)

JSON sem segredos: `lastBackupAt/Ok/Error/File/SizeBytes/Sha256`, `encrypted`, `cipher`, `offsite`, `lastStorageBackup*`, `lastRestoreTestAt/Ok`, `rtoSeconds` (+ `rtoDecryptSeconds`, `rtoRestoreSeconds`), `restoreChecks`.
Campos usados pela postura: `lastBackupAt`, `lastBackupOk`, `encrypted`, `offsite`, `lastRestoreTestAt`, `lastRestoreTestOk`, `rtoSeconds`. Código de saída 3 = backup local ok e envio externo falhou. `BV_BACKUP_ALERT_WEBHOOK` avisa nas falhas.

## Evidência de teste (sandbox de desenvolvimento, Postgres 16 local)

Ciclo completo executado contra o Postgres local: `pg-backup.sh` (age e openssl) → `storage-backup.sh` → `pg-restore-test.sh --storage`: contagens idênticas (6 tabelas) e migration conferida; **RTO medido 2 s** (base de desenvolvimento ≈ 3 MB — não representa produção).
Falhas provocadas e detectadas: ausência de chave (recusa), chave com permissão aberta (recusa), arquivo adulterado (sha256), chave errada (status `lastRestoreTestOk:false`). `bash -n` em todos os scripts; `shellcheck` **não disponível** no ambiente (não rodado); `docker compose config` valida os YAML; **imagens não foram construídas** nem upload S3/rclone/aws executado (sem credenciais/rede).
