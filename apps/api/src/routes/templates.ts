import { FastifyInstance } from 'fastify';
import { ApiError } from '../lib/apiErrors';
import { sendError } from '../lib/apiResponse';
import { resolveTeamScope, roleAtLeast } from '../lib/teamScope';
import { validateRequest, createTemplateSchema } from '../lib/validation';
import { resolveMetaNumber } from '../services/meta-number';
import {
  listTemplates, createTemplate, deleteTemplate, toPublicTemplate,
  uploadTemplateHeaderHandle, invalidateTemplateCache,
} from '../services/meta-templates';
import { countTextVariables } from '../services/template-components';

/**
 * Templates de mensagem dentro do app (item 4 do escopo ZapScript × Twilio)
 * — incluindo header de mídia (item 8).
 *
 * O que mudou: antes o cliente só LISTAVA templates aprovados (para escolher
 * numa campanha). Para criar um, ele tinha que sair do ZapScript, achar o
 * Business Manager da Meta, entender categoria/variável/exemplo e voltar. Era
 * o ponto em que o onboarding de campanhas morria — e um template reprovado
 * não dizia por quê em lugar nenhum nosso.
 *
 *   GET    /templates                 lista (com motivo de rejeição)
 *   POST   /templates                 cria (vai para análise da Meta)
 *   DELETE /templates/:name           apaga
 *   POST   /templates/media-handle    sobe a mídia de exemplo do header (item 8)
 *
 * Criar/apagar exige papel admin: template reprovado afeta a qualidade do
 * número da conta inteira.
 */

/** Teto da mídia de exemplo do header. A Meta recusa acima de ~5MB em imagem. */
const MAX_HANDLE_BYTES = 5 * 1024 * 1024;

const ALLOWED_HANDLE_MIME = new Set([
  'image/jpeg', 'image/png',
  'video/mp4', 'video/3gpp',
  'application/pdf',
]);

export default async function templatesRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  async function scopeForWrite(userId: string) {
    const scope = await resolveTeamScope(userId);
    if (!roleAtLeast(scope.role, 'admin')) {
      throw new ApiError('auth.scope_missing', {
        message: 'Só admin ou dono da conta pode criar ou apagar templates.',
      });
    }
    return scope;
  }

  // ── GET / — lista todos os templates do WABA ──────────────────────────────
  // Sem filtro de status: o cliente PRECISA ver PENDING (em análise) e
  // REJECTED (com o motivo) — era justamente o que não aparecia em lugar nenhum.
  app.get<{ Querystring: { numberId?: string; status?: string } }>(
    '/',
    auth,
    async (req: any, reply) => {
      const { ownerId } = await resolveTeamScope(req.user.sub);
      try {
        const ctx = await resolveMetaNumber(ownerId, req.query?.numberId);
        const all = await listTemplates(ctx.accessToken, ctx.wabaId);
        const wanted = req.query?.status?.toUpperCase();
        const rows = wanted && wanted !== 'ALL'
          ? all.filter((t) => t.status.toUpperCase() === wanted)
          : all;

        return {
          templates: rows.map(toPublicTemplate),
          number: {
            id: ctx.numberId, phoneNumber: ctx.phoneNumber,
            displayName: ctx.displayName, wabaId: ctx.wabaId,
          },
        };
      } catch (err) {
        if (err instanceof ApiError) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ── POST /media-handle — upload da mídia de exemplo do header (item 8) ────
  // A Meta NÃO aceita URL como exemplo de header de mídia na criação: exige um
  // `header_handle` obtido pela Resumable Upload API. Sem esta rota, criar
  // template com header de imagem/vídeo/PDF pelo app seria impossível.
  app.post(
    '/media-handle',
    { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      try {
        await scopeForWrite(req.user.sub);
      } catch (err) {
        if (err instanceof ApiError) return sendError(reply, err);
        throw err;
      }

      const file = await req.file().catch(() => null);
      if (!file) {
        return sendError(reply, 'request.invalid', {
          message: 'Envie o arquivo em multipart/form-data no campo "file".',
        });
      }

      const mime = String(file.mimetype || '').toLowerCase();
      if (!ALLOWED_HANDLE_MIME.has(mime)) {
        return sendError(reply, 'template.header_media_unsupported', {
          message: `Tipo "${mime}" não aceito como exemplo de header.`,
          details: { allowed: Array.from(ALLOWED_HANDLE_MIME) },
        });
      }

      const buffer: Buffer = await file.toBuffer();
      if (buffer.length > MAX_HANDLE_BYTES) {
        return sendError(reply, 'request.invalid', {
          message: `Arquivo de ${(buffer.length / 1024 / 1024).toFixed(1)}MB — o máximo é ${MAX_HANDLE_BYTES / 1024 / 1024}MB.`,
        });
      }

      try {
        const handle = await uploadTemplateHeaderHandle({ buffer, mimeType: mime });
        return { handle, mimeType: mime, bytes: buffer.length };
      } catch (err) {
        if (err instanceof ApiError) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ── POST / — cria o template (nasce PENDING na Meta) ──────────────────────
  app.post<{ Body: unknown; Querystring: { numberId?: string } }>(
    '/',
    { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      let ownerId: string;
      try {
        ({ ownerId } = await scopeForWrite(req.user.sub));
      } catch (err) {
        if (err instanceof ApiError) return sendError(reply, err);
        throw err;
      }

      const v = validateRequest(createTemplateSchema)(req.body);
      if (!v.valid) return sendError(reply, 'request.invalid', { message: v.error });
      const input = v.data as any;

      try {
        const ctx = await resolveMetaNumber(ownerId, req.query?.numberId);
        const components = buildCreateComponents(input);
        const created = await createTemplate(ctx.accessToken, ctx.wabaId, {
          name:     input.name,
          language: input.language,
          category: input.category,
          components,
        });
        return reply.code(201).send({
          template: {
            id: created.id, name: input.name, language: input.language,
            status: created.status, category: created.category,
          },
          // A aprovação é assíncrona (minutos a horas): o painel relista.
          message: 'Template enviado para análise da Meta. O status aparece aqui quando ela responder.',
        });
      } catch (err) {
        if (err instanceof ApiError) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ── DELETE /:name — apaga ─────────────────────────────────────────────────
  app.delete<{ Params: { name: string }; Querystring: { numberId?: string; hsmId?: string } }>(
    '/:name',
    auth,
    async (req: any, reply) => {
      let ownerId: string;
      try {
        ({ ownerId } = await scopeForWrite(req.user.sub));
      } catch (err) {
        if (err instanceof ApiError) return sendError(reply, err);
        throw err;
      }

      try {
        const ctx = await resolveMetaNumber(ownerId, req.query?.numberId);
        await deleteTemplate(ctx.accessToken, ctx.wabaId, req.params.name, req.query?.hsmId);
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiError) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ── POST /refresh — força releitura (ignora o cache de 60s) ───────────────
  app.post<{ Querystring: { numberId?: string } }>('/refresh', auth, async (req: any, reply) => {
    const { ownerId } = await resolveTeamScope(req.user.sub);
    try {
      const ctx = await resolveMetaNumber(ownerId, req.query?.numberId);
      await invalidateTemplateCache(ctx.wabaId);
      const all = await listTemplates(ctx.accessToken, ctx.wabaId, { useCache: false });
      return { templates: all.map(toPublicTemplate) };
    } catch (err) {
      if (err instanceof ApiError) return sendError(reply, err);
      throw err;
    }
  });
}

/**
 * Traduz o formulário do painel para os `components` da Graph API, validando
 * o que a Meta recusaria depois.
 *
 * A regra que mais morde na prática: todo `{{n}}` precisa de um exemplo. A Meta
 * reprova o template (não o envio) quando falta — e a reprovação chega por
 * e-mail dela, horas depois, sem explicação no nosso lado.
 */
export function buildCreateComponents(input: {
  header?: { format: string; text?: string; handle?: string; example?: string[] };
  body: { text: string; example?: string[] };
  footer?: { text: string };
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
}): Array<Record<string, any>> {
  const components: Array<Record<string, any>> = [];

  if (input.header) {
    const format = input.header.format.toUpperCase();

    if (format === 'TEXT') {
      if (!input.header.text) {
        throw new ApiError('request.invalid', { message: 'header.text é obrigatório quando header.format=TEXT.' });
      }
      const headerVars = countTextVariables(input.header.text);
      const headerExamples = input.header.example?.length ?? 0;
      if (headerVars !== headerExamples) {
        throw new ApiError('template.param_mismatch', {
          message: `O header tem ${headerVars} variável(is) e ${headerExamples} exemplo(s) — a Meta exige um exemplo por variável.`,
        });
      }
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: input.header.text,
        ...(headerVars > 0 ? { example: { header_text: input.header.example } } : {}),
      });
    } else {
      // IMAGE / VIDEO / DOCUMENT exigem o header_handle (POST /media-handle).
      if (!input.header.handle) {
        throw new ApiError('template.header_media_required', {
          message: `header.format=${format} exige header.handle — suba a mídia de exemplo em POST /templates/media-handle primeiro.`,
        });
      }
      components.push({
        type: 'HEADER',
        format,
        example: { header_handle: [input.header.handle] },
      });
    }
  }

  const bodyVars = countTextVariables(input.body.text);
  const bodyExamples = input.body.example?.length ?? 0;
  if (bodyVars !== bodyExamples) {
    throw new ApiError('template.param_mismatch', {
      message: `O corpo tem ${bodyVars} variável(is) e ${bodyExamples} exemplo(s) — a Meta exige um exemplo por variável.`,
      details: { variables: bodyVars, examples: bodyExamples },
    });
  }
  components.push({
    type: 'BODY',
    text: input.body.text,
    // body_text é uma lista de LISTAS (um conjunto de exemplos por linha).
    ...(bodyVars > 0 ? { example: { body_text: [input.body.example] } } : {}),
  });

  if (input.footer) components.push({ type: 'FOOTER', text: input.footer.text });

  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((b) => {
        if (b.type === 'URL') {
          if (!b.url) throw new ApiError('request.invalid', { message: `O botão "${b.text}" é do tipo URL e precisa de url.` });
          return { type: 'URL', text: b.text, url: b.url };
        }
        if (b.type === 'PHONE_NUMBER') {
          if (!b.phone_number) {
            throw new ApiError('request.invalid', { message: `O botão "${b.text}" é do tipo PHONE_NUMBER e precisa de phone_number.` });
          }
          return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number };
        }
        return { type: 'QUICK_REPLY', text: b.text };
      }),
    });
  }

  return components;
}
