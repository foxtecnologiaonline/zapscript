import { NextRequest, NextResponse } from 'next/server';

/* ─────────────────────────────────────────────────────────────────────────
   /api/track — coletor first-party de analytics do site (visitas e cliques).

   Roda na borda da Vercel: aqui temos acesso aos headers de geo que a Vercel
   injeta (x-vercel-ip-*), o que a API Fastify (Render) NÃO tem. Enriquecemos
   cada evento com país/região/cidade e encaminhamos para a API gravar.

   - Same-origin (chamado via navigator.sendBeacon), coberto por connect-src 'self'.
   - Nunca retorna erro ao cliente (analytics é best-effort, não pode quebrar UX).
   - Não persiste IP; só geo grosseira derivada pela Vercel.
   ───────────────────────────────────────────────────────────────────────── */

const API_URL = (process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'https://api.zapscript.me').replace(/\/$/, '');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const events = Array.isArray(body?.events) ? body.events.slice(0, 50) : [];
    if (events.length === 0) return NextResponse.json({ ok: true, stored: 0 });

    // Geo da Vercel (decodifica cidade que vem percent-encoded)
    const dec = (v: string | null) => {
      if (!v) return null;
      try { return decodeURIComponent(v); } catch { return v; }
    };
    const country = req.headers.get('x-vercel-ip-country');
    const region  = req.headers.get('x-vercel-ip-country-region');
    const city    = dec(req.headers.get('x-vercel-ip-city'));

    const enriched = events.map((e: Record<string, unknown>) => ({
      ...e,
      country: country || null,
      region:  region  || null,
      city:    city    || null,
    }));

    const internalSecret = process.env.INTERNAL_API_SECRET;
    await fetch(`${API_URL}/analytics/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(internalSecret ? { 'x-internal-secret': internalSecret } : {}),
      },
      body: JSON.stringify({ events: enriched }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});

    return NextResponse.json({ ok: true, stored: enriched.length });
  } catch {
    // best-effort: nunca propagar erro ao cliente
    return NextResponse.json({ ok: true, stored: 0 });
  }
}
