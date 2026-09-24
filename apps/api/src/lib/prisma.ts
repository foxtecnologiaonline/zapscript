import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

declare global {
  var __prisma: PrismaClient | undefined;
}

// ── PgBouncer compatibility ─────────────────────────────────────────────────────
// Supabase Pooler tem dois modos:
//   • Transaction mode — porta 6543 — requer ?pgbouncer=true (sem prepared statements)
//   • Session mode     — porta 5432 — compatível com Prisma nativo, conexões persistentes
//
// Para servidores persistentes (Fastify/Node long-running), session mode é preferível:
// mantém conexões abertas, elimina overhead de handshake por query, menor latência.
// Só adicionamos pgbouncer=true se a URL usar a porta 6543 (transaction mode).
function buildDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  // Session mode (porta 5432 no pooler ou direct): não precisa de pgbouncer=true
  const isSessionMode = !url.includes(':6543') && !url.includes('pgbouncer=true');
  if (isSessionMode) return url;

  // Transaction mode (porta 6543): garantir pgbouncer=true
  if (url.includes('pgbouncer=true')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}pgbouncer=true`;
}

const datasourceUrl = buildDatasourceUrl();

// ── Teto de segurança para findMany sem `take` ──────────────────────────────
// Havia 140 findMany sem take no apps/api, 88 deles dentro de handler HTTP.
// Enquanto a base é pequena não dói; com volume, uma listagem sem limite vira
// latência e pico de memória no processo inteiro (e a resposta HTTP carrega
// tudo junto).
//
// Este teto é rede de segurança, NÃO paginação: é alto de propósito, para não
// alterar o resultado de nenhuma query legítima de hoje. A paginação de
// verdade (limit/offset explícitos) é feita nas rotas que listam coleções que
// crescem com o uso.
//
// Cobertura: a extensão intercepta findMany de topo. Relação carregada por
// include/select NÃO passa por aqui — esse caso continua sem teto.
//
// E, principalmente, NUNCA trunca em silêncio: ao bater o teto sai um warn
// nomeando o model, que é o sinal de que aquela query precisa de paginação
// real. Silêncio aqui seria pior que o problema original — uma varredura que
// espera 6000 linhas e recebe 5000 quebraria regra de negócio sem deixar
// rastro.
// Validado, e não só parseInt: este número entra como `take` em TODA query
// sem take da API. Um PRISMA_FIND_MANY_CAP mal digitado viraria NaN (take:NaN)
// ou 0 (zero linhas em tudo) — quebrando a API inteira em silêncio por causa
// de uma variável de ambiente. Valor inválido cai no default e avisa.
const CAP_DEFAULT = 5_000;
function lerCap(): number {
  const bruto = process.env.PRISMA_FIND_MANY_CAP;
  if (!bruto) return CAP_DEFAULT;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 1) {
    logger.warn(
      { valor: bruto, usando: CAP_DEFAULT },
      '[Prisma] PRISMA_FIND_MANY_CAP inválido (precisa ser inteiro >= 1) — usando o default.',
    );
    return CAP_DEFAULT;
  }
  return n;
}
const FIND_MANY_HARD_CAP = lerCap();

function withFindManyCap<T extends PrismaClient>(client: T) {
  return client.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          const semTake = args.take === undefined || args.take === null;
          if (semTake) args = { ...args, take: FIND_MANY_HARD_CAP };

          const result = await query(args);

          if (semTake && Array.isArray(result) && result.length >= FIND_MANY_HARD_CAP) {
            logger.warn(
              { model, cap: FIND_MANY_HARD_CAP },
              `[Prisma] findMany em ${model} bateu o teto de ${FIND_MANY_HARD_CAP} linhas sem take — ` +
              'resultado TRUNCADO. Esta query precisa de paginação explícita.',
            );
          }
          return result;
        },
      },
    },
  });
}

const basePrisma =
  global.__prisma ||
  (withFindManyCap(
    new PrismaClient({
      datasourceUrl,
      log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error', 'warn'],
      errorFormat: 'pretty',
    }),
  ) as unknown as PrismaClient);

export const prisma = basePrisma;

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
