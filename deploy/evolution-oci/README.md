# Evolution API no Oracle OCI (São Paulo) — clone do VPS atual

Objetivo: subir uma cópia do Evolution API num VPS **brasileiro** (Oracle OCI, região São Paulo/Vinhedo) para testar se o **aviso de fraude/golpe** ao conectar o WhatsApp some quando o IP deixa de ser dos EUA (hoje Hostinger/Boston). Se sumir no teste, migramos de vez.

> ⚠️ O aviso tem **duas causas**: (1) IP de datacenter em país estrangeiro — isto aqui resolve; (2) Baileys ser não-oficial — só a API Oficial resolve (já em preparação no branch `feat/whatsapp-official-embedded-signup`). Este passo ataca a causa (1).

---

## O que já está pronto neste diretório

| Arquivo | Função |
|---|---|
| `docker-compose.yml` | Stack: Evolution + Postgres + Redis + Caddy (SSL automático) |
| `Caddyfile` | Proxy reverso + HTTPS Let's Encrypt para `$DOMAIN` |
| `.env.example` | Modelo de variáveis (copie para `.env` e preencha) |
| `setup.sh` | Bootstrap: abre firewall do SO → instala Docker → sobe a stack |
| `test-instance.sh` | Cria instância de teste e devolve o QR Code |

---

## Parte 1 — SUAS MÃOS (console OCI, só você consegue fazer)

### 1.1 Criar a VM
Console OCI → **Compute → Instances → Create instance**:
- **Image:** Ubuntu 22.04
- **Shape:** `VM.Standard.A1.Flex` (Ampere/ARM, **Always Free**) — 2 OCPU / 12 GB RAM
- **Networking:** *Assign a public IPv4 address* = **Yes**
- **SSH keys:** *Paste public keys* → cole o conteúdo de `oci_evolution.pub` (gerado na Parte 2)
- **Create**

Anote o **Public IP** da instância.

### 1.2 Abrir portas 80/443 na rede (Security List)
Console OCI → **Networking → Virtual Cloud Networks** → sua VCN → **Security Lists** → *Default Security List* → **Add Ingress Rules**, crie duas:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

> Isto libera só a **rede**. As portas no **SO** (iptables) são abertas pelo `setup.sh` — é o famoso gotcha da OCI: precisa dos dois.

### 1.3 Criar o DNS
No seu provedor de DNS do domínio `zapscript.me`, crie um registro:
- **Tipo:** A · **Nome:** `evo` · **Valor:** o Public IP da VM · **TTL:** baixo (300)

Resultado: `evo.zapscript.me → IP`. (Se quiser outro subdomínio, ajuste `DOMAIN` no `.env`.)

---

## Parte 2 — Chave SSH (gerada na sua máquina Windows)

Já vou gerar para você em `C:\Users\avrfd\.ssh\oci_evolution` (privada) e `.pub` (pública).
O conteúdo do `.pub` é o que você cola no passo **1.1**.

Conectar depois:
```powershell
ssh -i "$env:USERPROFILE\.ssh\oci_evolution" ubuntu@SEU_IP_PUBLICO
```

---

## Parte 3 — Subir a stack (no VPS, via SSH)

```bash
# 1) Enviar os arquivos para o VPS (rode na sua máquina, PowerShell):
#    scp -i "$env:USERPROFILE\.ssh\oci_evolution" -r "C:\FOX tecnologIA\ZapScript\deploy\evolution-oci" ubuntu@SEU_IP:~/evolution
#
# 2) Conectar:
ssh -i "$env:USERPROFILE\.ssh\oci_evolution" ubuntu@SEU_IP

# 3) No VPS:
cd ~/evolution
cp .env.example .env
nano .env        # preencha DOMAIN, AUTHENTICATION_API_KEY, POSTGRES_PASSWORD, EVO_VERSION
#   Gerar chaves:  openssl rand -hex 32   (API key)   ·   openssl rand -hex 24   (Postgres)
chmod +x setup.sh test-instance.sh
./setup.sh
```

Acompanhe o SSL: `sudo docker compose logs -f caddy` — quando aparecer `certificate obtained`, acesse `https://evo.zapscript.me`.

> **Versão da imagem:** use a MESMA do VPS atual. Na Hostinger rode `docker ps --format '{{.Image}}'` e copie a tag para `EVO_VERSION` no `.env`. Versões diferentes podem mudar o schema do banco.

---

## Parte 4 — Teste do aviso de fraude

```bash
./test-instance.sh teste-br
```
Pega o QR / pairingCode, conecta um número de teste e observa se o aviso some.
- **Sumiu** → seguimos para a migração definitiva (apontar a API do ZapScript para `https://evo.zapscript.me` e migrar as instâncias).
- **Continua** → a causa é o Baileys (não-oficial); foco total na API Oficial.

---

## Parte 5 — Migração definitiva (só depois do teste OK — NÃO fazer agora)

1. No painel do ZapScript/Render, trocar `EVOLUTION_API_URL` → `https://evo.zapscript.me` e `EVOLUTION_API_KEY` → a nova `AUTHENTICATION_API_KEY`.
2. Recriar/reconectar as instâncias dos clientes no novo host (cada um reescaneia o QR), **ou** migrar o banco da Hostinger:
   ```bash
   # opcional, mesma EVO_VERSION nos dois lados:
   # na Hostinger:  docker compose exec -T postgres pg_dump -U evolution evolution > evo.sql
   # copiar evo.sql para o OCI e:
   #   docker compose exec -T postgres psql -U evolution -d evolution < evo.sql
   ```
3. Validar mensagens entrando/saindo e desligar a Hostinger.

> Esta parte é **manual e coordenada** — me confirme antes. Nada aqui altera produção sozinho.
