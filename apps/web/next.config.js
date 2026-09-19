/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL:          process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_NAME:         process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_SUPABASE_URL:     process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },

  async redirects() {
    return [
      // ── Consolidação de posts duplicados de nicho (SEO: evitar canibalização) ──
      { source: '/blog/transcricao-de-audio-para-advogados',  destination: '/blog/transcrever-audio-whatsapp-advogados',  permanent: true },
      { source: '/blog/converter-audio-whatsapp-advogados',   destination: '/blog/transcrever-audio-whatsapp-advogados',  permanent: true },
      { source: '/blog/transcricao-de-audio-para-corretores', destination: '/blog/transcrever-audio-whatsapp-corretores', permanent: true },
      { source: '/blog/converter-audio-whatsapp-corretores',  destination: '/blog/transcrever-audio-whatsapp-corretores', permanent: true },
      { source: '/blog/transcrever-audio-cliente-vendas',     destination: '/blog/transcrever-audio-whatsapp-vendas',     permanent: true },
      { source: '/blog/converter-audio-whatsapp-vendas',      destination: '/blog/transcrever-audio-whatsapp-vendas',     permanent: true },
      // ── Unificação dos programas de indicação e afiliados (Regulamento v4) ──
      // /indique era uma landing separada (bônus de áudio grátis); agora é o
      // mesmo programa único descrito em /afiliados.
      { source: '/indique', destination: '/afiliados', permanent: true },
      // ── Atende migrou de /app (sem shell/sidebar) para /dashboard (2026-09) ──
      // Mesmo padrão já usado por Campanhas/Copiloto — mas, diferente deles, o
      // Atende já tinha uso real em produção (inclusive links enviados por
      // WhatsApp antes do deploy), então o redirect é obrigatório aqui.
      { source: '/app/atende',        destination: '/dashboard/atende',        permanent: true },
      { source: '/app/atende/:path*', destination: '/dashboard/atende/:path*', permanent: true },
    ];
  },

  async headers() {
    return [
      // ── Headers de segurança para todas as rotas ───────────────────────
      {
        source: '/(.*)',
        headers: [
          // Impede que o site seja embutido em iframes (clickjacking)
          { key: 'X-Frame-Options',        value: 'DENY' },
          // Evita MIME sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Política de referrer
          { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
          // Restringe uso de câmera, mic, etc.
          { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          // Aviso de copyright
          { key: 'X-Copyright',            value: '© 2026 ZapScript / FOX TecnologIA. Unauthorized copying prohibited.' },
        ],
      },
      // ── Dashboard e rotas internas: noindex ────────────────────────────
      {
        source: '/dashboard/(.*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/app/(.*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/admin/(.*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
      {
        source: '/payment/(.*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
