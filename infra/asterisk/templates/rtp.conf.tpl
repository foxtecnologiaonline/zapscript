[general]
rtpstart={{BV_RTP_START|10000}}
rtpend={{BV_RTP_END|10200}}
rtpchecksums=no
strictrtp=yes
icesupport=yes
;#if BV_STUN_SERVER
stunaddr={{BV_STUN_SERVER}}
;#endif
