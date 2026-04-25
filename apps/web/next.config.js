/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL:          process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_NAME:         process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_SUPABASE_URL:     process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
};

module.exports = nextConfig;
