/**
 * CLI — popula o órgão de DEMONSTRAÇÃO do Balcão Virtual ("TJTO — Balcão Virtual (demo)", slug `demo`).
 * Idempotente: upsert por chaves naturais (slug, e-mail, nome da fila/setor, título do artigo, data do feriado, item+período da cota).
 *
 *   cd apps/api
 *   BV_DEMO_PASSWORD='DemoSenha12345' npx ts-node src/balcao/cli/seed-demo.ts [--slug demo]
 *
 * Senha: BV_DEMO_PASSWORD (aplicada a todos os usuários demo, também nos já existentes) ou, se ausente, gerada e
 * impressa uma única vez (usuários já existentes mantêm a senha atual). Lê DATABASE_URL do ambiente.
 * Os artigos de FAQ são TEXTOS DE EXEMPLO genéricos — o órgão deve revisá-los/substituí-los antes de produção.
 */
import { prisma } from '../../lib/prisma';
import { passwordPolicyError } from '../core/passwords';
import { hashPasswordAsync } from '../iam/passwordAsync';
import { generateTempPassword } from '../iam/service';
import { parseArgs } from './create-org';

export interface SeedOptions { slug?: string; name?: string; password?: string; log?: (m: string) => void }
export interface SeedResult { orgId: string; slug: string; password: string | null; passwordGenerated: boolean; users: Array<{ email: string; role: string }> }

const DEMO_NAME = 'TJTO — Balcão Virtual (demo)';

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC. */
function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Feriados nacionais (lei) de um ano. Estaduais/municipais devem ser acrescentados pelo órgão (POST /admin/holidays). */
export function nationalHolidays(year: number): Array<{ day: Date; name: string }> {
  const d = (m: number, dd: number) => new Date(Date.UTC(year, m - 1, dd));
  const goodFriday = new Date(easter(year).getTime() - 2 * 86400_000);
  return [
    { day: d(1, 1), name: 'Confraternização Universal' }, { day: goodFriday, name: 'Sexta-feira Santa' },
    { day: d(4, 21), name: 'Tiradentes' }, { day: d(5, 1), name: 'Dia do Trabalho' }, { day: d(9, 7), name: 'Independência do Brasil' },
    { day: d(10, 12), name: 'Nossa Senhora Aparecida' }, { day: d(11, 2), name: 'Finados' }, { day: d(11, 15), name: 'Proclamação da República' },
    { day: d(11, 20), name: 'Dia da Consciência Negra' }, { day: d(12, 25), name: 'Natal' },
  ];
}

const KB: Array<{ title: string; question: string; answer: string; category: string; tags: string[] }> = [
  { title: 'Horário de atendimento', category: 'INFORMACAO', tags: ['horario', 'atendimento'],
    question: 'Qual é o horário de atendimento?',
    answer: 'O atendimento humano funciona em dias úteis, de segunda a sexta-feira, das 8h às 18h (horário de Tocantins). Fora desse horário você pode deixar sua mensagem e ela será respondida no próximo dia útil. Em feriados não há atendimento humano.' },
  { title: 'Segunda via de certidão', category: 'CERTIDAO', tags: ['certidao', 'segunda via'],
    question: 'Como solicitar a segunda via de uma certidão?',
    answer: 'A segunda via de certidões pode ser solicitada pelo portal do tribunal, na área de certidões, informando o CPF ou CNPJ do solicitante. Algumas certidões são emitidas na hora; outras podem exigir análise e o pagamento de custas. Se não encontrar a certidão desejada, informe o tipo e seus dados ao atendente.' },
  { title: 'Como consultar um processo', category: 'PROCESSO', tags: ['processo', 'consulta', 'andamento'],
    question: 'Como consulto o andamento do meu processo?',
    answer: 'Use o número do processo (formato CNJ, 20 dígitos) na consulta processual pública do portal do tribunal. Processos em segredo de justiça só podem ser consultados pelas partes e seus advogados, com certificado digital ou login autorizado. Se tiver o número em mãos, o atendente também pode orientar você.' },
  { title: 'Audiências: data, horário e participação', category: 'AUDIENCIA', tags: ['audiencia', 'videoconferencia'],
    question: 'Como saber a data da minha audiência e como participar?',
    answer: 'A data e o horário da audiência constam na intimação e no andamento do processo. Audiências por videoconferência recebem o link de acesso pelos meios de contato informados no processo. Chegue ou conecte-se com alguns minutos de antecedência, com documento de identificação com foto.' },
  { title: 'Justiça gratuita', category: 'GRATUIDADE', tags: ['gratuidade', 'custas'],
    question: 'Como pedir a gratuidade da justiça?',
    answer: 'Quem não pode arcar com custas e despesas sem prejuízo do próprio sustento pode pedir a gratuidade da justiça ao juiz, na petição inicial ou durante o processo, apresentando declaração de hipossuficiência e, se solicitado, comprovantes de renda. A decisão é do juiz do caso.' },
  { title: 'Protocolo de petições', category: 'PROCESSO', tags: ['peticao', 'protocolo', 'peticionamento'],
    question: 'Como protocolar uma petição ou documento?',
    answer: 'Petições em processos eletrônicos são protocoladas pelo sistema de peticionamento do tribunal, por advogados ou partes habilitadas, com certificado digital ou login autorizado. Quem não tem advogado pode procurar a unidade de atendimento do fórum para orientação sobre o protocolo.' },
  { title: 'Acesso e senha dos sistemas', category: 'ACESSO', tags: ['senha', 'acesso', 'login'],
    question: 'Esqueci minha senha ou não consigo acessar o sistema. O que fazer?',
    answer: 'Use a opção "Esqueci minha senha" na tela de login para redefinir por e-mail. Se o e-mail cadastrado não existir mais ou o acesso continuar bloqueado, abra um chamado de suporte informando seu nome, CPF e o sistema que está tentando acessar, sem enviar a senha.' },
  { title: 'Dados pessoais e LGPD', category: 'LGPD', tags: ['lgpd', 'dados pessoais', 'privacidade'],
    question: 'Como solicito acesso, correção ou exclusão dos meus dados pessoais?',
    answer: 'Você pode solicitar confirmação de tratamento, acesso, correção ou informação sobre o uso dos seus dados pessoais pelo canal de atendimento. O pedido é registrado com protocolo e respondido no prazo legal. Dados de processos judiciais seguem regras próprias de publicidade e sigilo.' },
  { title: 'Atendimento acessível e Libras', category: 'ACESSIBILIDADE', tags: ['acessibilidade', 'libras', 'deficiencia'],
    question: 'Existe atendimento para pessoas com deficiência e em Libras?',
    answer: 'O Balcão Virtual oferece atendimento por escrito acessível a leitores de tela, tradução para Libras por avatar (VLibras) e videochamada com legenda ao vivo para quem precisa. Informe ao atendente a necessidade de acessibilidade para ser atendido da forma adequada.' },
  { title: 'Meu processo está parado', category: 'PROCESSO', tags: ['prazo', 'andamento', 'demora'],
    question: 'Meu processo parece parado. O que posso fazer?',
    answer: 'Confira primeiro a última movimentação na consulta processual: alguns atos dependem de prazos legais. Se não houve movimentação por tempo superior ao razoável, o advogado pode pedir andamento ao juízo; quem não tem advogado pode registrar o pedido no atendimento da unidade, informando o número do processo.' },
];

const QUOTAS: Array<{ item: string; period: string; limit: bigint; action: string; alertAtPct: number }> = [
  { item: 'WA_SERVICE', period: 'MONTH', limit: 10000n, action: 'ALERT', alertAtPct: 80 },
  { item: 'WA_UTILITY', period: 'MONTH', limit: 2000n, action: 'ALERT', alertAtPct: 80 },
  { item: 'WA_MARKETING', period: 'MONTH', limit: 500n, action: 'BLOCK', alertAtPct: 80 },
  { item: 'VOICE_MINUTES', period: 'MONTH', limit: 6000n, action: 'ALERT', alertAtPct: 85 },
  { item: 'STORAGE_BYTES', period: 'MONTH', limit: 50n * 1024n * 1024n * 1024n, action: 'ALERT', alertAtPct: 90 },
  { item: 'AI_CALLS', period: 'DAY', limit: 5000n, action: 'ALERT', alertAtPct: 80 },
];

export async function seedDemo(opts: SeedOptions = {}): Promise<SeedResult> {
  const log = opts.log ?? (() => undefined);
  const slug = opts.slug ?? 'demo';
  let password = opts.password;
  let generated = false;
  if (password) {
    const err = passwordPolicyError(password);
    if (err) throw new Error(`BV_DEMO_PASSWORD inválida: ${err}`);
  } else { password = generateTempPassword(); generated = true; }
  const forceReset = !generated; // senha informada: aplica a todos; gerada: só aos usuários novos
  const hash = await hashPasswordAsync(password);

  const org = await prisma.bvOrg.upsert({ where: { slug }, create: { name: opts.name ?? DEMO_NAME, slug }, update: { name: opts.name ?? DEMO_NAME } });
  const orgId = org.id;

  // Setores
  const sectors: Record<string, string> = {};
  for (const [key, name, email] of [['atend', 'Atendimento ao Cidadão', 'atendimento@demo.balcao.local'], ['cartorio', 'Cartório Judicial', 'cartorio@demo.balcao.local'], ['ti', 'Tecnologia da Informação', 'ti@demo.balcao.local']]) {
    sectors[key] = (await prisma.bvSector.upsert({ where: { orgId_name: { orgId, name } }, create: { orgId, name, email }, update: { active: true } })).id;
  }

  // Usuários (e-mails de demonstração em domínio reservado/inexistente)
  const people: Array<{ key: string; email: string; name: string; role: string; skills: string[]; sip: string | null; sector: string; max: number }> = [
    { key: 'admin', email: 'admin@demo.balcao.local', name: 'Ana Administradora', role: 'ADMIN', skills: [], sip: null, sector: 'ti', max: 3 },
    { key: 'sup', email: 'supervisor@demo.balcao.local', name: 'Sérgio Supervisor', role: 'SUPERVISOR', skills: ['geral', 'processos'], sip: null, sector: 'atend', max: 3 },
    { key: 'a1', email: 'atendente1@demo.balcao.local', name: 'Alice Atendente', role: 'ATENDENTE', skills: ['geral', 'certidoes'], sip: '6001', sector: 'atend', max: 4 },
    { key: 'a2', email: 'atendente2@demo.balcao.local', name: 'Bruno Atendente', role: 'ATENDENTE', skills: ['processos', 'audiencias'], sip: '6002', sector: 'cartorio', max: 3 },
    { key: 'a3', email: 'atendente3@demo.balcao.local', name: 'Carla Atendente', role: 'ATENDENTE', skills: ['suporte', 'sistemas'], sip: '6003', sector: 'ti', max: 3 },
    { key: 'fiscal', email: 'fiscal@demo.balcao.local', name: 'Fábio Fiscal', role: 'FISCAL', skills: [], sip: null, sector: 'atend', max: 1 },
  ];
  const ids: Record<string, string> = {};
  let createdUsers = 0;
  for (const p of people) {
    const common = { name: p.name, role: p.role, skills: p.skills, maxConcurrent: p.max, sectorId: sectors[p.sector], sipExtension: p.sip, active: true, failedLogins: 0, lockedUntil: null };
    const existing = await prisma.bvUser.findUnique({ where: { orgId_email: { orgId, email: p.email } } });
    if (existing) {
      ids[p.key] = (await prisma.bvUser.update({ where: { id: existing.id }, data: { ...common, ...(forceReset ? { passwordHash: hash, mustChangePassword: false } : {}) } })).id;
    } else {
      ids[p.key] = (await prisma.bvUser.create({ data: { orgId, email: p.email, ...common, passwordHash: hash, mustChangePassword: false } })).id;
      createdUsers++;
    }
  }

  // Filas, membros e categorias
  const queues = [
    { slug: 'atendimento-geral', name: 'Atendimento Geral', categories: ['INFORMACAO', 'CERTIDAO', 'GERAL'], priority: 0, sector: 'atend', members: ['a1', 'a2'], sla: 300 },
    { slug: 'processos-judiciais', name: 'Processos Judiciais', categories: ['PROCESSO', 'AUDIENCIA', 'PRAZO'], priority: 10, sector: 'cartorio', members: ['a2', 'a1'], sla: 600 },
    { slug: 'suporte-tecnico', name: 'Suporte Técnico', categories: ['SUPORTE', 'SISTEMA', 'ACESSO'], priority: 5, sector: 'ti', members: ['a3'], sla: 600 },
  ];
  for (const q of queues) {
    const row = await prisma.bvQueue.upsert({
      where: { orgId_slug: { orgId, slug: q.slug } },
      create: { orgId, slug: q.slug, name: q.name, categories: q.categories, priority: q.priority, sectorId: sectors[q.sector], slaFirstResponseSec: q.sla, strategy: 'LEAST_BUSY' },
      update: { name: q.name, categories: q.categories, priority: q.priority, sectorId: sectors[q.sector], active: true },
    });
    await prisma.bvQueueMember.createMany({ data: q.members.map((m) => ({ queueId: row.id, userId: ids[m] })), skipDuplicates: true });
  }

  // Base de conhecimento (artigos aprovados)
  for (const a of KB) {
    const existing = await prisma.bvKbArticle.findFirst({ where: { orgId, title: a.title } });
    const data = { question: a.question, answer: a.answer, category: a.category, tags: [...a.tags, 'demo'], status: 'APPROVED', source: 'MANUAL', approvedById: ids.admin, approvedAt: new Date(), nextReviewAt: new Date(Date.now() + 180 * 86400_000) };
    if (existing) await prisma.bvKbArticle.update({ where: { id: existing.id }, data });
    else {
      const created = await prisma.bvKbArticle.create({ data: { orgId, title: a.title, authorId: ids.admin, ...data } });
      await prisma.bvKbArticleVersion.create({ data: { articleId: created.id, version: 1, snapshot: { title: a.title, ...data }, changedById: ids.admin } });
    }
  }

  // Feriados nacionais 2026–2027
  for (const y of [2026, 2027]) {
    for (const h of nationalHolidays(y)) {
      await prisma.bvHoliday.upsert({ where: { orgId_day: { orgId, day: h.day } }, create: { orgId, day: h.day, name: h.name }, update: { name: h.name } });
    }
  }

  // Cotas de exemplo
  for (const q of QUOTAS) {
    await prisma.bvQuota.upsert({ where: { orgId_item_period: { orgId, item: q.item, period: q.period } }, create: { orgId, ...q }, update: { limit: q.limit, action: q.action, alertAtPct: q.alertAtPct } });
  }

  log(`Órgão demo "${slug}" pronto (id ${orgId}): ${people.length} usuários, ${queues.length} filas, ${KB.length} artigos, feriados 2026–2027, ${QUOTAS.length} cotas.`);
  return { orgId, slug, password: forceReset || createdUsers > 0 ? password : null, passwordGenerated: generated && createdUsers > 0, users: people.map((p) => ({ email: p.email, role: p.role })) };
}

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = console.log): Promise<number> {
  if (!env.DATABASE_URL) { log('Erro: defina DATABASE_URL.'); return 2; }
  const args = parseArgs(argv);
  const slug = typeof args.slug === 'string' ? args.slug : 'demo';
  const r = await seedDemo({ slug, password: env.BV_DEMO_PASSWORD || undefined, log });
  log('Usuários (login com e-mail + senha; informe orgSlug se o e-mail existir em mais de um órgão):');
  for (const u of r.users) log(`  ${u.role.padEnd(10)} ${u.email}`);
  log(`Órgão (orgSlug): ${r.slug}`);
  if (r.passwordGenerated) log(`Senha gerada (anote — não será exibida de novo; usuários já existentes mantiveram a senha anterior): ${r.password}`);
  else if (r.password) log('Senha: a definida em BV_DEMO_PASSWORD.');
  else log('Todos os usuários já existiam: senhas mantidas (defina BV_DEMO_PASSWORD para redefini-las).');
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((code) => prisma.$disconnect().finally(() => process.exit(code)))
    .catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => undefined); process.exit(1); });
}
