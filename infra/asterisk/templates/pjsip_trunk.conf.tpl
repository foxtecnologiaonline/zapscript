; ============================================================================================
; Tronco SIP com a telefonia VoIP do TJTO (entroncamento SIP — TR 1.1.3.1.15.2).
; TEMPLATE: renderizado por render.js a partir das variáveis de ambiente (nenhum segredo real aqui).
;   BV_TRUNK_HOST       IP/host do SBC/PABX do TJTO. VAZIO = sem tronco (bancada/PoC só com softphones)
;   BV_TRUNK_PORT       porta SIP (padrão 5060)
;   BV_TRUNK_TRANSPORT  transport-udp | transport-tcp | transport-tls (padrão transport-udp)
;   BV_TRUNK_AUTH       registration | userpass | ip   (padrão ip)
;   BV_TRUNK_USER / BV_TRUNK_PASS   usuário/senha (registration e userpass)
;   BV_TRUNK_IPS        IPs de origem aceitos (identify), separados por vírgula (obrigatório em modo ip)
;   BV_TRUNK_CODECS     ulaw,alaw,opus (padrão ulaw,alaw)
;   BV_TRUNK_FROM_USER / BV_TRUNK_FROM_DOMAIN   identidade no From
;   BV_LANGUAGE         idioma dos sons (ex.: pt_BR) — opcional
; ============================================================================================

;#if BV_TRUNK_HOST
;#if BV_TRUNK_AUTH=registration
[tjto-trunk-reg]
type=registration
outbound_auth=tjto-trunk-auth
server_uri=sip:{{BV_TRUNK_HOST}}:{{BV_TRUNK_PORT|5060}}
client_uri=sip:{{BV_TRUNK_USER}}@{{BV_TRUNK_HOST}}
contact_user={{BV_TRUNK_FROM_USER|balcao}}
retry_interval=60
forbidden_retry_interval=600
expiration=3600
transport={{BV_TRUNK_TRANSPORT|transport-udp}}
;#endif

;#if BV_TRUNK_USER
[tjto-trunk-auth]
type=auth
auth_type=userpass
username={{BV_TRUNK_USER}}
password={{BV_TRUNK_PASS}}
;#endif

[tjto-trunk]
type=endpoint
transport={{BV_TRUNK_TRANSPORT|transport-udp}}
context=from-trunk
disallow=all
allow={{BV_TRUNK_CODECS|ulaw,alaw}}
; DTMF por RFC 4733 (RFC 2833) — o ARI recebe ChannelDtmfReceived
dtmf_mode=rfc4733
aors=tjto-trunk
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
trust_id_inbound=yes
;#if BV_LANGUAGE
; idioma dos sons do Asterisk (digits:/characters: do protocolo) — só use se o pacote de sons desse idioma estiver instalado
language={{BV_LANGUAGE}}
;#endif
trust_id_outbound=yes
send_pai=yes
from_user={{BV_TRUNK_FROM_USER|balcao}}
;#if BV_TRUNK_FROM_DOMAIN
from_domain={{BV_TRUNK_FROM_DOMAIN}}
;#endif
;#if BV_TRUNK_USER
outbound_auth=tjto-trunk-auth
;#endif
;#if BV_TRUNK_AUTH=userpass
auth=tjto-trunk-auth
;#endif

[tjto-trunk]
type=aor
contact=sip:{{BV_TRUNK_HOST}}:{{BV_TRUNK_PORT|5060}}
qualify_frequency=30
max_contacts=1

;#if BV_TRUNK_IPS
[tjto-trunk]
type=identify
endpoint=tjto-trunk
match={{BV_TRUNK_IPS}}
;#endif
;#endif

; Cabeçalhos X-* (ex.: X-URA-Option da URA 0800) chegam ao dialplan e são expostos ao ARI
; como variáveis BV_X_* (ver extensions.conf e channelvars em ari.conf).
