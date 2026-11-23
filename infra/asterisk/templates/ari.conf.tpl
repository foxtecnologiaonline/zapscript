[general]
enabled=yes
pretty=no
; origens permitidas para o WebSocket do ARI (a API não é navegador)
allowed_origins=
; cabeçalhos X-* da URA 0800 viram variáveis do canal e aparecem no StasisStart
channelvars={{BV_ARI_CHANNELVARS|BV_X_URA_OPTION,BV_X_URA_ID,BV_X_PROTOCOLO_0800}}

[{{BV_ARI_USER|balcao}}]
type=user
read_only=no
password={{BV_ARI_PASS}}
password_format=plain
