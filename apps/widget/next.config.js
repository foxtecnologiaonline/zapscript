/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // /public/widget.js precisa poder ser embutido e chamado a partir de
  // QUALQUER domínio de terceiro (é esse o produto) — sem X-Frame-Options
  // nem restrição de origem no próprio arquivo estático. CORS das rotas
  // /api/widget/* é tratado explicitamente em cada handler.
  async headers() {
    return [
      {
        source: '/widget.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
      {
        source: '/dashboard/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

module.exports = nextConfig;
