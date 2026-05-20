/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    NEXT_PUBLIC_API_URL:          process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_NAME:         process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_SUPABASE_URL:     process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
