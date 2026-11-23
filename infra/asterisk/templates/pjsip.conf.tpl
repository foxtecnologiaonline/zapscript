; Transports. Os endpoints dos atendentes (pjsip_agents.conf) são gerados por gen-agents.js.
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
;#if BV_EXTERNAL_IP
external_media_address={{BV_EXTERNAL_IP}}
external_signaling_address={{BV_EXTERNAL_IP}}
local_net={{BV_LOCAL_NET|10.0.0.0/8}}
local_net=172.16.0.0/12
local_net=192.168.0.0/16
;#endif

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060
;#if BV_EXTERNAL_IP
external_media_address={{BV_EXTERNAL_IP}}
external_signaling_address={{BV_EXTERNAL_IP}}
;#endif

; WebRTC (SIP sobre WebSocket seguro) — servido pelo http.conf (porta 8089, TLS)
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0
;#if BV_EXTERNAL_IP
external_media_address={{BV_EXTERNAL_IP}}
external_signaling_address={{BV_EXTERNAL_IP}}
;#endif

;#if BV_TRUNK_TLS_CERT
[transport-tls]
type=transport
protocol=tls
bind=0.0.0.0:5061
cert_file={{BV_TRUNK_TLS_CERT}}
priv_key_file={{BV_TRUNK_TLS_KEY}}
method=tlsv1_2
;#endif

#include pjsip_trunk.conf
#include pjsip_agents.conf
