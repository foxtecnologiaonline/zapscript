import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt     = 'ZapScript — Conversão Inteligente de Áudios do WhatsApp';
export const size    = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #050a07 0%, #0d1c19 60%, #050a07 100%)',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow */}
        <div style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'rgba(16,185,129,0.08)',
          filter: 'blur(80px)',
          display: 'flex',
        }} />
        <div style={{
          position: 'absolute',
          bottom: -120,
          left: -80,
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'rgba(245,158,11,0.05)',
          filter: 'blur(80px)',
          display: 'flex',
        }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 40 }}>
          <div style={{
            width: 72,
            height: 72,
            background: '#10b981',
            borderRadius: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 40px rgba(16,185,129,0.4)',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
            </svg>
          </div>
          <span style={{ fontSize: 52, fontWeight: 800, color: '#10b981', letterSpacing: -2 }}>
            ZapScript
          </span>
        </div>

        {/* Headline */}
        <div style={{
          fontSize: 52,
          fontWeight: 800,
          color: '#f0fdf4',
          textAlign: 'center',
          lineHeight: 1.1,
          maxWidth: 900,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          Transforme seus áudios em
        </div>
        <div style={{
          fontSize: 52,
          fontWeight: 800,
          color: '#10b981',
          textAlign: 'center',
          lineHeight: 1.2,
          display: 'flex',
        }}>
          textos, resumos e insights
        </div>

        {/* Subtitle */}
        <div style={{
          fontSize: 24,
          color: 'rgba(240,253,244,0.5)',
          textAlign: 'center',
          marginTop: 24,
          maxWidth: 700,
          display: 'flex',
        }}>
          Conversão automática com IA para seus áudios do WhatsApp
        </div>

        {/* Bottom badges */}
        <div style={{ display: 'flex', gap: 16, marginTop: 48 }}>
          {['10x Mais rápido', '99% Precisão', 'PT-BR Otimizado'].map(badge => (
            <div key={badge} style={{
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 100,
              padding: '10px 22px',
              fontSize: 18,
              color: '#6ee7b7',
              fontWeight: 600,
              display: 'flex',
            }}>
              {badge}
            </div>
          ))}
        </div>

        {/* Domain */}
        <div style={{
          position: 'absolute',
          bottom: 32,
          fontSize: 18,
          color: 'rgba(16,185,129,0.3)',
          display: 'flex',
        }}>
          zapscript.me
        </div>
      </div>
    ),
    { ...size }
  );
}
