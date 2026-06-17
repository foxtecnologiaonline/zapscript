import { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';

/* ─────────────────────────────────────────────────────────
   Demo pública da landing page — "transcreva 1 áudio grátis"
   - SEM autenticação (isca de topo de funil)
   - Captura o e-mail do visitante (lead) antes de revelar o resultado
   - Transcreve via Groq Whisper (formatos comuns, sem ffmpeg) + resume via Claude
   - Controles de abuso/custo: rate-limit por IP + limite de tamanho de arquivo
   ───────────────────────────────────────────────────────── */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Cap pequeno para conter custo: ~4MB cobre vários minutos de áudio comprimido (ogg/opus/mp3)
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['.ogg', '.opus', '.mp3', '.mp4', '.m4a', '.wav', '.webm', '.aac', '.flac'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mapeia extensão → mime aceito pela Groq. */
function mimeFor(ext: string): string {
  switch (ext) {
    case '.mp3':  return 'audio/mpeg';
    case '.mp4':
    case '.m4a':  return 'audio/mp4';
    case '.wav':  return 'audio/wav';
    case '.webm': return 'audio/webm';
    case '.aac':  return 'audio/aac';
    case '.flac': return 'audio/flac';
    default:      return 'audio/ogg'; // .ogg / .opus
  }
}

async function transcribeWithGroq(buffer: Buffer, filename: string, mime: string): Promise<{ text: string; duration: number }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'pt');
  form.append('response_format', 'verbose_json');

  const res = await fetch(GROQ_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body:    form,
  });
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${errTxt.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  return { text: (data?.text || '').trim(), duration: Number(data?.duration) || 0 };
}

async function summarize(text: string): Promise<string[]> {
  try {
    const res = await anthropic.messages.create({
      model:      'claude-3-haiku-20240307',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Resuma o áudio transcrito abaixo em até 4 tópicos curtos e objetivos (bullets), em português, capturando o que importa (decisões, pedidos, prazos, números). Responda APENAS com os tópicos, um por linha, sem numeração e sem introdução.\n\nTranscrição:\n"""${text.slice(0, 6000)}"""`,
      }],
    });
    const raw = res.content?.[0]?.type === 'text' ? res.content[0].text : '';
    return raw
      .split('\n')
      .map(l => l.replace(/^[\s\-•*\d.)]+/, '').trim())
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}

export default async function demoRoutes(app: FastifyInstance) {
  // ── POST /demo/transcribe — transcrição gratuita única (lead capture) ──────
  app.post(
    '/transcribe',
    { config: { rateLimit: { max: 3, timeWindow: '30 minutes' } } },
    async (req: any, reply) => {
      if (!GROQ_API_KEY) {
        return reply.code(503).send({ error: 'Demo temporariamente indisponível. Tente novamente em instantes.' });
      }

      const data = await req.file().catch(() => null);
      if (!data) return reply.code(400).send({ error: 'Envie um arquivo de áudio.' });

      // Consumir o arquivo primeiro: só após drenar o stream do file os campos
      // que vêm DEPOIS dele no corpo multipart ficam disponíveis em data.fields.
      const buffer   = await data.toBuffer();
      const filename = data.filename || 'audio.ogg';

      // E-mail (lead) — obrigatório para liberar o resultado. Lido após o buffer
      // para tolerar qualquer ordem dos campos no multipart.
      const email = (data.fields?.email?.value || '').toString().trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) {
        return reply.code(400).send({ error: 'Informe um e-mail válido para ver o resultado.' });
      }

      const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED.includes(ext)) {
        return reply.code(400).send({ error: `Formato não suportado. Use: ${ALLOWED.join(', ')}` });
      }
      if (buffer.length === 0) return reply.code(400).send({ error: 'Arquivo vazio.' });
      if (buffer.length > MAX_BYTES) {
        return reply.code(413).send({ error: 'Áudio muito grande para a demo (máx. 4MB / ~5 min). Crie sua conta para enviar áudios maiores.' });
      }

      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;

      let text = '';
      let duration = 0;
      try {
        const r = await transcribeWithGroq(buffer, filename, mimeFor(ext));
        text = r.text;
        duration = r.duration;
      } catch (err: any) {
        app.log.error({ err: err?.message }, '[Demo] Falha na transcrição Groq');
        return reply.code(502).send({ error: 'Não foi possível transcrever o áudio agora. Tente novamente.' });
      }

      if (!text) {
        return reply.code(422).send({ error: 'O áudio parece silencioso ou ininteligível. Tente outro.' });
      }

      const bullets = await summarize(text);

      // Registrar lead (best-effort)
      prisma.demoLead.create({ data: { email, ip, durationSec: duration || null } })
        .catch(err => app.log.warn({ err: err?.message }, '[Demo] Falha ao registrar lead'));

      app.log.info(`[Demo] Transcrição entregue: lead=${email} dur=${Math.round(duration)}s`);
      return {
        ok:          true,
        text,
        bullets,
        durationSec: Math.round(duration),
      };
    }
  );

  // ── POST /demo/newsletter/interest — lista de espera para novas features ──
  app.post<{ Body: { email?: string } }>(
    '/newsletter/interest',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { email } = req.body || {};
      if (!email || !EMAIL_RE.test(email.trim())) {
        return reply.code(400).send({ error: 'E-mail inválido.' });
      }
      const adminEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM?.replace(/.*<(.+)>/, '$1');
      if (adminEmail) {
        sendEmail(
          adminEmail,
          `[ZapScript] Nova inscrição na lista de espera: ${email.trim()}`,
          `<div style="font-family:sans-serif;padding:24px"><p>E-mail: <strong>${email.trim()}</strong></p><p>Fonte: seção "Em breve" da homepage</p></div>`,
        ).catch(() => {});
      }
      return reply.code(200).send({ ok: true });
    }
  );
}
