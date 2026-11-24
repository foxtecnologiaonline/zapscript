# Asterisk do Balcão Virtual (voz)

Container Asterisk 20 (PJSIP + ARI + WebRTC) controlado pela API do Balcão (`apps/api/src/balcao/channels/voice`).
Documentação da API de voz (endpoints, formato da URA, eventos, variáveis): [`docs/balcao/api-voice.md`](../../docs/balcao/api-voice.md).

```
 TJTO (VoIP/SBC) ──SIP/RTP──►  Asterisk (container)  ◄──ARI (HTTP+WS, rede Docker)──  API Balcão
 0800 / DIDs                   │  PJSIP: tjto-trunk                                      │ URA, filas, gravação,
                               │  PJSIP: ramais 1001… (WebRTC)                           │ transbordo, minutos
 Atendente (navegador) ◄─WSS 8089 + RTP/DTLS-SRTP─┘
```

Tudo que o Asterisk lê é **gerado no start** a partir de variáveis de ambiente (`docker-entrypoint.sh`):

| Arquivo | Origem |
|---|---|
| `pjsip.conf`, `pjsip_trunk.conf`, `ari.conf`, `http.conf`, `rtp.conf` | `templates/*.tpl` renderizados por `render.js` |
| `pjsip_agents.conf` (ramais WebRTC) | `gen-agents.js` |
| `extensions.conf`, `modules.conf`, `musiconhold.conf`, `logger.conf` | `conf/` (estáticos) |

Nenhum segredo fica no repositório: `asterisk.env` (a partir de `asterisk.env.example`) é local ao servidor.

## 1. Pré-requisitos

- Servidor com Docker + Compose v2 (o mesmo Vultr da API: `216.238.120.65`).
- Nome DNS para o WSS dos atendentes. **Mais simples: reusar `api.zapscript.me`** (cert Let's Encrypt já existente e
  renovando por webroot, ver `CLAUDE.md`). Outro nome (ex.: `voz.zapscript.me`) também serve: crie o registro A e emita
  o certificado por **webroot** (`certbot certonly --webroot -w /var/www/html -d voz.zapscript.me`; nunca `--standalone`).
- Do TJTO (ver §6): IP/host do SBC, método de autenticação, DID(s)/0800 que chegarão ao Balcão, codecs, e os IPs de origem.

## 2. Segredos e variáveis

```bash
cd infra/asterisk
cp asterisk.env.example asterisk.env && chmod 600 asterisk.env
openssl rand -hex 24   # → BV_ARI_PASS
openssl rand -hex 32   # → BV_SIP_SECRET
```

`BV_ARI_PASS` e `BV_SIP_SECRET` precisam ser **idênticos** no `.env` da API (`/opt/zapscript/.env`) — o segredo SIP deriva a
senha de cada ramal (HMAC) nos dois lados; trocá-lo exige reiniciar os dois e re-logar os softphones.
Tabela completa de variáveis: `asterisk.env.example` (lado Asterisk) e `docs/balcao/api-voice.md` (lado API).

Obrigatórias: `BV_ARI_PASS`, `BV_SIP_SECRET`, `BV_EXTERNAL_IP` (IP **público**; sem ele o áudio não flui atrás do NAT do Docker).

## 3. Certificado do WSS (WebRTC)

O navegador só abre `wss://` com certificado válido. O Asterisk serve TLS direto na porta **8089** (`http.conf`).

```bash
# no host (fora do Docker), com o certbot já em webroot:
install -m 755 infra/asterisk/certbot-deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/asterisk-wss.sh
BV_WSS_DOMAIN=api.zapscript.me BV_KEYS_DIR=/opt/zapscript/asterisk/keys /etc/letsencrypt/renewal-hooks/deploy/asterisk-wss.sh   # 1ª cópia
```

O hook copia `fullchain.pem`/`privkey.pem` para a pasta montada em `/etc/asterisk/keys` (dono = uid do asterisk, 1000) a cada
renovação e pede `core reload` ao Asterisk. **Se o reload não renovar o certificado do WSS na prática**, reinicie o container
em janela sem chamadas (`docker restart balcao-asterisk`) — ver "Não verificado". Em `asterisk.env` (ou no compose)
aponte `BV_KEYS_DIR=/opt/zapscript/asterisk/keys`.

Só bancada: `BV_WSS_SELF_SIGNED=1` gera um certificado autoassinado (o navegador o recusa até você abrir
`https://<host>:8089` e aceitá-lo uma vez).

## 4. Subir o Asterisk

```bash
cd infra/asterisk
mkdir -p moh && cp /caminho/musica-espera/*.wav moh/     # wav/ulaw 8 kHz mono; opcional (sem arquivos = silêncio na espera)
docker compose -f docker-compose.asterisk.yml --env-file asterisk.env up -d --build
docker logs -f balcao-asterisk          # "[balcao] configuração gerada em /etc/asterisk: …" e "Asterisk Ready"
docker exec balcao-asterisk asterisk -rx 'pjsip show endpoints'
docker exec balcao-asterisk asterisk -rx 'pjsip show transports'
```

O compose entra na rede Docker **externa** `zapscript` (a da API) para a API alcançar `http://asterisk:8088`. Se a rede da
API tiver outro nome: `docker inspect zapscript-api --format '{{json .NetworkSettings.Networks}}'` e ajuste `BV_DOCKER_NETWORK`.

### Imagem

`Dockerfile` compila o Asterisk 20 LTS do fonte oficial (`ASTERISK_VERSION`, padrão `20-current`) — build de ~15–30 min,
imagem grande. Sons em português para falar o protocolo (`digits:`/`characters:`): passe `CORE_SOUNDS_PT_URL` (URL de um
`.tar.gz` com o pacote *core sounds* pt_BR) e defina `BV_LANGUAGE=pt_BR`; sem isso o protocolo é falado com os sons em inglês.
**Alternativa documentada:** qualquer imagem Asterisk ≥ 18 com `res_pjsip`, `res_ari`, `res_http_websocket`, DTLS-SRTP e
layout upstream (`/etc/asterisk`, `/var/lib/asterisk`, `/var/spool/asterisk`) serve, desde que você monte
`render.js`, `gen-agents.js`, `templates/`, `conf/` e `docker-entrypoint.sh` em `/opt/balcao` e use o entrypoint daqui.

## 5. Portas, RTP e firewall

| Porta | Proto | Quem acessa | Observação |
|---|---|---|---|
| 5060 | UDP/TCP | **só IPs do TJTO** | SIP do tronco |
| 5061 | TCP | só TJTO | SIP TLS (opcional: `BV_TRUNK_TLS_CERT`/`KEY`) |
| 8089 | TCP | Internet (navegadores dos atendentes) | WSS `/ws` |
| 10000–10200 | UDP | Internet (TJTO + navegadores) | RTP — igual a `BV_RTP_START..END` |
| 8088 | TCP | **ninguém no host** | ARI em texto puro; só rede Docker (`expose`, não `ports`) |

```bash
ufw allow from <IP-SBC-TJTO> to any port 5060 proto udp
ufw allow from <IP-SBC-TJTO> to any port 5060 proto tcp
ufw allow 8089/tcp
ufw allow 10000:10200/udp
```

Dimensionamento do item 11: cada perna de chamada usa 1–2 portas RTP; 201 portas ≈ 50–100 chamadas. Para mais canais:
aumente `BV_RTP_START..END` (rtp.conf **e** a publicação no compose mudam juntos) ou, com centenas de canais, use
`network_mode: host` no serviço (remova `ports`/`networks`; então a API acessa o ARI por `http://172.17.0.1:8088`, e o
`BV_HTTP_BIND=172.17.0.1` restringe o ARI ao gateway Docker). Publicar milhares de UDP em bridge é lento.
CPU: sem transcodificação (ulaw/alaw ponta a ponta) o custo é baixo; Opus↔G.711 e a gravação em WAV pesam mais.

## 6. Tronco SIP com a VoIP do TJTO, DIDs e 0800

**Pedir ao TJTO:** host/IP e porta do SBC; transporte (UDP/TCP/TLS); autenticação (**por IP** é o usual em troncos
corporativos; ou usuário/senha, ou registro); IPs de origem das chamadas que ele enviará; codecs (G.711 a-law/μ-law);
DTMF (**RFC 4733**); DIDs e o 0800 que apontarão para o Balcão; formato do número entregue no INVITE (com/sem `+55`/DDD);
se a URA 0800 do TJTO envia **cabeçalhos `X-*`** (ex.: `X-URA-Option`, `X-URA-Id`, `X-Protocolo-0800`); e o número/prefixo de
destino do **transbordo** para os ramais do TJTO.

Preencha em `asterisk.env` e reinicie o container:

```bash
BV_TRUNK_HOST=sbc.tjto.exemplo        # vazio = sem tronco (PoC só com softphones)
BV_TRUNK_PORT=5060
BV_TRUNK_TRANSPORT=transport-udp      # transport-tcp | transport-tls
BV_TRUNK_AUTH=ip                      # ip | userpass | registration
BV_TRUNK_IPS=203.0.113.10,203.0.113.11   # identify: obrigatório para ENTRADA (também no modo registration)
# userpass/registration: BV_TRUNK_USER / BV_TRUNK_PASS
BV_TRUNK_CODECS=ulaw,alaw
```

Depois, na **API** (por órgão): `PUT /balcao/voice/config` com `dids` (os números que o TJTO entrega), `preserveHeaders`
(cabeçalhos `X-*` a copiar para a conversa), `trunkEndpoint` (`tjto-trunk`, nome do endpoint acima) e `ari` (se não usar
`BV_ARI_URL`) — exemplo no `api-voice.md`. Em seguida `POST /balcao/voice/config/test`: consulta `GET /asterisk/info` e o
estado do endpoint do tronco (`online` = qualify OK).

- **DID/0800:** o dialplan (`extensions.conf`) entrega à API o número discado como chegou (`${EXTEN}`); o fluxo da URA é escolhido
  por `definition.dids` e a API só reconhece o DID **idêntico** ao que o tronco envia (ajuste os `dids` conforme o formato do TJTO).
- **Cabeçalhos X-\*:** `X-URA-Option`, `X-URA-Id`, `X-Protocolo-0800` já viram variáveis `BV_X_*` no dialplan; outros nomes
  listados em `preserveHeaders` são lidos pela API (`PJSIP_HEADER`). Vão para `metadata.voice.headers` da conversa e podem escolher
  o ponto de entrada da URA (`entryByHeader`).
- **Transbordo / click-to-call:** saem por `PJSIP/<número>@tjto-trunk`; `transferCallerId` decide se o TJTO vê o número original
  do cidadão ou o do tronco.

## 7. Ramais WebRTC dos atendentes

`gen-agents.js` cria um endpoint PJSIP por ramal de `BV_AGENT_EXT_START` a `BV_AGENT_EXT_END` (padrão 1001–1050, até 2001)
com a senha derivada `HMAC-SHA256(BV_SIP_SECRET, ramal)` (base64url, 24 caracteres) — a mesma que a API entrega em
`GET /balcao/voice/softphone`. Para gerar e inspecionar fora do container:

```bash
BV_SIP_SECRET=… BV_AGENT_EXT_START=1001 BV_AGENT_EXT_END=1050 node gen-agents.js /tmp/pjsip_agents.conf
```

Vincule o ramal ao usuário: `PATCH /balcao/admin/users/:id` com `{ "sipExtension": "1001" }` (único por órgão). Um ramal fora da
faixa gerada não consegue registrar. Aumentar a faixa = reiniciar o container.

## 8. Volumes

| Volume | No Asterisk | Na API | Para quê |
|---|---|---|---|
| `balcao-asterisk-recordings` | `/var/spool/asterisk/recording` | `BV_ASTERISK_RECORDING_DIR` (mesmo caminho) | gravações WAV; a API move para `BV_STORAGE_DIR` com sha256 e apaga o original (`BV_ASTERISK_RECORDING_KEEP=1` mantém) |
| `balcao-asterisk-sounds` | `/var/lib/asterisk/sounds/balcao` | `BV_ASTERISK_SOUNDS_DIR` (mesmo caminho) | prompts da URA (áudio enviado) e cache de TTS escritos pela API |
| `./moh` (bind, ro) | `/var/lib/asterisk/moh` | — | música de espera |
| `./keys` (bind, ro) | `/etc/asterisk/keys` | — | certificado do WSS |

Sem o volume de **gravações** compartilhado a API baixa o arquivo pela API do ARI (funciona, mais lento). Sem o volume de **sons**
os prompts de texto/áudio **não tocam** (o Asterisk não os encontra) — ele é obrigatório. `BV_STORAGE_DIR` da API tem de ser um
volume persistente com backup (`infra/backup`): é onde as gravações ficam.

Trecho para o compose da API (mesmo host):

```yaml
services:
  api:
    environment:
      BV_VOICE_ENABLED: "1"
      BV_ARI_URL: http://asterisk:8088
      BV_ASTERISK_RECORDING_DIR: /var/spool/asterisk/recording
      BV_ASTERISK_SOUNDS_DIR: /var/lib/asterisk/sounds/balcao
    volumes:
      - balcao-asterisk-recordings:/var/spool/asterisk/recording
      - balcao-asterisk-sounds:/var/lib/asterisk/sounds/balcao
      - /var/lib/zapscript/bv-storage:/var/lib/zapscript/bv-storage
volumes:
  balcao-asterisk-recordings: { external: true }
  balcao-asterisk-sounds: { external: true }
```

(A API roda como root no container; o Asterisk como uid 1000 — ela lê e apaga os arquivos sem ajuste. Se mudar o usuário da
API, dê-lhe acesso de escrita a esses dois volumes.)

## 9. Teste de bancada sem tronco

Veja o runbook completo em `docs/balcao/api-voice.md` §"Runbook de teste". Resumo: deixe `BV_TRUNK_HOST` vazio, defina
`BV_TEST_CALLER_EXT=9001` (ramal SIP comum que cai no contexto `from-trunk`, senha derivada do segredo), registre um softphone
(Linphone/Zoiper) como `9001@<host>:5060` e disque o DID do fluxo publicado; o atendente atende no softphone WebRTC do navegador.
**Remova `BV_TEST_CALLER_EXT` em produção.**

## 10. Diagnóstico

```bash
docker exec -it balcao-asterisk asterisk -rvvv
  pjsip show endpoint tjto-trunk | pjsip show contacts | pjsip set logger on
  ari show apps | core show channels | bridge show all | rtp set debug on
```

| Sintoma | Causa provável |
|---|---|
| Container sai com "certificado WSS não legível" | `./keys` vazio/sem permissão para o uid 1000 (§3) |
| Softphone não registra (401/403) | `BV_SIP_SECRET` diferente entre API e Asterisk; ramal fora da faixa; ramal não definido no usuário |
| Registra mas sem áudio / áudio mudo num sentido | `BV_EXTERNAL_IP` ausente, faixa RTP bloqueada no firewall, ICE/TURN do navegador (`BV_ICE_SERVERS`) |
| Chamada do tronco não chega à API | `BV_TRUNK_IPS` ausente (identify), DID sem fluxo ativo/`dids` divergente do formato recebido, `BV_VOICE_ENABLED` ≠ 1, ARI inalcançável (`GET /balcao/voice/status`) |
| Prompts em silêncio | volume de sons não compartilhado, ou TTS desligado (`BV_TTS_ENABLED=1` + chave) para prompts só-texto |
| Protocolo falado em inglês | falta o pacote pt_BR (§4) |

## Não verificado

Nada aqui foi executado contra um Asterisk real (sem Docker no ambiente de desenvolvimento): `render.js`/`gen-agents.js` foram
executados e os arquivos gerados inspecionados e cobertos por teste, mas **o Dockerfile nunca foi construído, o compose nunca subiu, o
Asterisk nunca carregou estas configurações** (sintaxe dos `.conf`, opções do PJSIP na versão escolhida, DTLS/ICE com um navegador
real, reload do certificado TLS, pjsip com o SBC do TJTO). Isso é a primeira coisa a fazer na PoC — ver `docs/balcao/api-voice.md`.
