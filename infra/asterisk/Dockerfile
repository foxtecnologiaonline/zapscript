# ──────────────────────────────────────────────────────────────────────────────────────────────────
# Asterisk 20 LTS para o Balcão Virtual (PJSIP + ARI + WebRTC), compilado do código-fonte oficial.
# Compilar do fonte dá o layout padrão do upstream (/etc/asterisk, /var/lib/asterisk, /var/spool/asterisk),
# que é o que a API assume (BV_ASTERISK_RECORDING_DIR / BV_ASTERISK_SOUNDS_DIR). Imagem grande (~1,5 GB):
# otimizar com multi-stage só depois que a PoC estiver validada.
#
# Build (contexto = esta pasta):   docker build -t balcao-asterisk:20 infra/asterisk
# Alternativa documentada: usar uma imagem pronta do Asterisk 20 com PJSIP+ARI e montar os templates/entrypoint
# daqui (ver README.md, "Imagem").
#
# NÃO VERIFICADO: este Dockerfile nunca foi construído no ambiente de desenvolvimento (sem Docker).
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS node

FROM debian:bookworm-slim

ARG ASTERISK_VERSION=20-current
ARG ASTERISK_UID=1000
# Pacote de sons em pt_BR (digits:/characters: do protocolo falado). Vazio = só inglês. Informe a URL de um
# .tar.gz com o pacote "core sounds" pt_BR em formato wav/ulaw; ele é extraído em /var/lib/asterisk/sounds/pt_BR.
ARG CORE_SOUNDS_PT_URL=""
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl wget bzip2 xz-utils openssl procps libstdc++6 build-essential \
 && mkdir -p /usr/src/asterisk \
 && cd /usr/src/asterisk \
 && curl -fsSL "https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-${ASTERISK_VERSION}.tar.gz" | tar xz --strip-components=1 \
 && ./contrib/scripts/install_prereq install \
 && ./configure --with-pjproject-bundled --with-jansson-bundled \
 && make menuselect.makeopts \
 && menuselect/menuselect --disable BUILD_NATIVE --enable CORE-SOUNDS-EN-ULAW --enable MOH-OPSOUND-ULAW menuselect.makeopts \
 && make -j"$(nproc)" \
 && make install \
 && ldconfig \
 && cd / && rm -rf /usr/src/asterisk \
 && rm -rf /var/lib/apt/lists/*

RUN if [ -n "${CORE_SOUNDS_PT_URL}" ]; then \
      mkdir -p /var/lib/asterisk/sounds/pt_BR && curl -fsSL "${CORE_SOUNDS_PT_URL}" | tar xz -C /var/lib/asterisk/sounds/pt_BR; \
    fi

# Usuário não-root (uid fixo para compartilhar volumes com a API) e diretórios que o Asterisk escreve.
RUN useradd --system --uid "${ASTERISK_UID}" --home-dir /var/lib/asterisk --shell /usr/sbin/nologin asterisk \
 && mkdir -p /etc/asterisk /var/spool/asterisk/recording /var/lib/asterisk/sounds/balcao /var/lib/asterisk/moh /var/log/asterisk /var/run/asterisk \
 && chown -R asterisk:asterisk /etc/asterisk /var/spool/asterisk /var/lib/asterisk /var/log/asterisk /var/run/asterisk

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY render.js gen-agents.js /opt/balcao/
COPY templates /opt/balcao/templates
COPY conf /opt/balcao/conf
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# SIP (udp/tcp), SIP TLS, WSS dos atendentes, ARI (somente rede Docker) e faixa RTP (ver rtp.conf / BV_RTP_START..END)
EXPOSE 5060/udp 5060/tcp 5061/tcp 8089/tcp 8088/tcp 10000-10200/udp

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD asterisk -rx "core waitfullybooted" | grep -q "fully booted" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
