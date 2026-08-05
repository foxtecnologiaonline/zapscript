import { prisma } from './prisma';

/* ─────────────────────────────────────────────────────────
   Link de indicação legível — combina 1º nome + iniciais dos demais nomes
   (ex.: "João Pedro Silva" → "joaops"), pra trocar o link técnico
   (zapscript.me/cadastro?ref=ck9x7h2a1b) por algo curto e sem cara de
   código: zapscript.me/i/joaops.
   Gerado sob demanda (1ª vez que a carteira é acessada) e fixo depois —
   não muda se o usuário editar o nome depois.
   ───────────────────────────────────────────────────────── */

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Gera a base do slug a partir de um nome: 1º nome + iniciais dos demais. */
function slugBase(name: string): string {
  const parts = stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  const [first, ...rest] = parts;
  const initials = rest.map(p => p[0]).join('');
  return (first + initials).slice(0, 24);
}

/**
 * Busca o slug do usuário, gerando (e salvando) se ainda não existir.
 * Sem nome cadastrado, usa a parte local do e-mail como base.
 * Colisão: acrescenta um número (joaops, joaops2, joaops3...).
 */
export async function getOrCreateReferralSlug(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { referralSlug: true, name: true, email: true },
  });
  if (!user) throw new Error('Usuário não encontrado.');
  if (user.referralSlug) return user.referralSlug;

  const base = slugBase(user.name || '') || slugBase(user.email.split('@')[0]) || 'user';

  let candidate = base;
  let suffix = 1;
  // Poucas colisões esperadas (nomes diferentes já geram bases diferentes);
  // laço simples é suficiente e não precisa de índice extra.
  while (await prisma.user.findUnique({ where: { referralSlug: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  await prisma.user.update({ where: { id: userId }, data: { referralSlug: candidate } });
  return candidate;
}

/**
 * Resolve um slug (ou refCode antigo) para o ID do usuário — usado pelo
 * link curto /i/[code]. Retorna null se não encontrar.
 */
export async function resolveReferralHandle(handle: string): Promise<{ userId: string; refCode: string } | null> {
  const user = await prisma.user.findFirst({
    where:  { OR: [{ referralSlug: handle }, { refCode: handle }] },
    select: { id: true, refCode: true },
  });
  return user ? { userId: user.id, refCode: user.refCode } : null;
}
