[general]
enabled=yes
; ARI/HTTP em texto puro: acessível só dentro da rede Docker (NÃO publique a 8088)
bindaddr=0.0.0.0
bindport=8088
; WSS dos atendentes (WebRTC). Em produção, prefira publicar só /ws via nginx (ver README).
tlsenable=yes
tlsbindaddr={{BV_HTTP_TLS_BIND|0.0.0.0:8089}}
tlscertfile={{BV_WSS_CERT|/etc/asterisk/keys/fullchain.pem}}
tlsprivatekey={{BV_WSS_KEY|/etc/asterisk/keys/privkey.pem}}
