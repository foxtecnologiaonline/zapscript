import fs from 'fs';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma';
import { getOrgSettings } from '../core/settings';
import { storageRoot } from '../core/storage';
import { keyStatus } from './keys';
import { activeLegalHold, getSecuritySettings, minAuditDays } from './config';
import { listIncidents } from './incidents';

export type CheckStatus = 'OK' | 'WARN' | 'FAIL' | 'INFO';
export interface Check { id: string; title: string; status: CheckStatus; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; detail: string; remediation?: string }

const ok = (id: string, title: string, detail: string): Check => ({ id, title, status: 'OK', severity: 'LOW', detail });
const bad = (id: string, title: string, status: CheckStatus, severity: Check['severity'], detail: string, remediation: string): Check => ({ id, title, status, severity, detail, remediation });
const PRIVILEGED = ['ADMIN', 'SUPERVISOR', 'FISCAL'];

export interface BackupStatus { lastBackupAt?: string; lastBackupOk?: boolean; lastRestoreTestAt?: string; lastRestoreTestOk?: boolean; rtoSeconds?: number; encrypted?: boolean; offsite?: boolean; [k: string]: unknown }

/** Lê o JSON de status escrito por infra/backup/*.sh (BV_BACKUP_STATUS_FILE). */
export function readBackupStatus(): BackupStatus | null {
  const f = process.env.BV_BACKUP_STATUS_FILE;
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) as BackupStatus; } catch { return null; }
}

const ageH = (iso?: string) => (iso && Number.isFinite(Date.parse(iso)) ? (Date.now() - Date.parse(iso)) / 3_600_000 : null);

export async function computePosture(orgId: string, req?: FastifyRequest): Promise<{ generatedAt: string; summary: Record<CheckStatus, number>; score: number; checks: Check[] }> {
  const checks: Check[] = [];
  const env = process.env;

  // chaves e segredos
  checks.push(/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY ?? '')
    ? ok('crypto.encryption_key', 'ENCRYPTION_KEY presente e válida', 'Chave mestra de 256 bits configurada (valor não exibido).')
    : bad('crypto.encryption_key', 'ENCRYPTION_KEY ausente ou inválida', 'FAIL', 'CRITICAL', 'Sem a chave mestra o conteúdo cifrado não pode ser lido.', 'Definir ENCRYPTION_KEY (64 hex) no .env do servidor.'));
  let kidInfo = '';
  try {
    const ks = await keyStatus(orgId);
    kidInfo = ` kid atual=${ks.currentKid}; em uso: ${[...new Set(ks.usage.flatMap((u) => Object.keys(u.byKid)))].join(', ') || 'nenhum'}`;
    const plain = ks.usage.reduce((a, u) => a + u.plaintext, 0);
    const old = ks.usage.reduce((a, u) => a + Object.entries(u.byKid).filter(([k]) => k !== ks.currentKid).reduce((x, [, n]) => x + n, 0), 0);
    if (!env.BV_FIELD_KEYS || !env.BV_FIELD_KEY_CURRENT) checks.push(bad('crypto.field_keys', 'Chaves de campo versionadas não configuradas', 'WARN', 'MEDIUM', `BV_FIELD_KEYS/BV_FIELD_KEY_CURRENT ausentes: usando só a chave derivada de ENCRYPTION_KEY (kid 0), sem rotação possível.${kidInfo}`, 'Definir BV_FIELD_KEYS e BV_FIELD_KEY_CURRENT (ver docs/balcao/api-security.md, "Rotação de chaves").'));
    else checks.push(ok('crypto.field_keys', 'Chaves de campo versionadas configuradas', `Chave atual kid=${ks.currentKid}.${kidInfo}`));
    if (plain > 0) checks.push(bad('crypto.plaintext_rows', 'Registros sem cifra de campo', 'FAIL', 'HIGH', `${plain} valor(es) sem prefixo bv1.`, 'Executar POST /security/keys/rotate (cifra valores legados).'));
    if (old > 0) checks.push(bad('crypto.old_keys', 'Registros cifrados com chave antiga', 'WARN', 'LOW', `${old} registro(s) não usam a chave atual.`, 'Executar POST /security/keys/rotate até remaining=0.'));
  } catch (e: any) {
    checks.push(bad('crypto.field_keys', 'Chaves de campo inválidas', 'FAIL', 'CRITICAL', `Erro ao carregar o keyring: ${String(e?.message).slice(0, 120)}`, 'Corrigir BV_FIELD_KEYS / BV_FIELD_KEY_CURRENT.'));
  }
  const jwt = env.JWT_SECRET ?? '';
  const weak = jwt.length < 32 || new Set(jwt).size < 10 || /(test|change|secret123|password|example)/i.test(jwt);
  checks.push(weak ? bad('auth.jwt_secret', 'JWT_SECRET fraco', 'FAIL', 'HIGH', `Comprimento ${jwt.length}; deve ter ≥ 32 caracteres aleatórios.`, 'Gerar com `openssl rand -hex 48` e reiniciar a API.') : ok('auth.jwt_secret', 'JWT_SECRET forte', 'Comprimento e variedade adequados.'));

  // MFA
  const sec = await getSecuritySettings(orgId);
  const missingRoles = ['ADMIN', 'SUPERVISOR'].filter((r) => !sec.requireMfaRoles.includes(r));
  checks.push(missingRoles.length
    ? bad('mfa.required_roles', 'MFA não exigido para perfis privilegiados', 'FAIL', 'HIGH', `Perfis sem MFA obrigatório: ${missingRoles.join(', ')}.`, 'Definir settings.security.requireMfaRoles (PATCH /balcao/admin/org) incluindo ADMIN e SUPERVISOR.')
    : ok('mfa.required_roles', 'MFA exigido para perfis privilegiados', `Perfis: ${sec.requireMfaRoles.join(', ')}.`));
  const users = await prisma.bvUser.findMany({ where: { orgId, active: true }, select: { role: true, totpEnabled: true } });
  const withMfa = users.filter((u) => u.totpEnabled).length;
  const pct = users.length ? Math.round((withMfa / users.length) * 100) : 0;
  const privNoMfa = users.filter((u) => PRIVILEGED.includes(u.role) && !u.totpEnabled).length;
  checks.push(privNoMfa
    ? bad('mfa.adoption', `MFA ativo em ${pct}% dos usuários`, 'WARN', 'MEDIUM', `${privNoMfa} usuário(s) privilegiado(s) sem MFA ativo (${withMfa}/${users.length} no total).`, 'Pedir a ativação de TOTP no primeiro acesso (ou OIDC com MFA do IdP).')
    : ok('mfa.adoption', `MFA ativo em ${pct}% dos usuários`, `${withMfa}/${users.length} usuários ativos; todos os privilegiados com MFA.`));

  // retenção
  const s = await getOrgSettings(orgId);
  const r = s.retention;
  const minA = minAuditDays();
  const retOk = [r.messagesDays, r.recordingsDays, r.auditDays, r.logsDays].every((n) => typeof n === 'number' && n > 0);
  checks.push(!retOk ? bad('retention.configured', 'Retenção não configurada', 'FAIL', 'MEDIUM', 'Algum prazo de settings.retention é inválido.', 'Definir messagesDays, recordingsDays, auditDays e logsDays.')
    : r.auditDays < minA ? bad('retention.audit_min', 'auditDays abaixo do mínimo', 'WARN', 'LOW', `auditDays=${r.auditDays} < mínimo ${minA} (o mínimo prevalece).`, 'Ajustar settings.retention.auditDays ou BV_AUDIT_MIN_DAYS.')
      : ok('retention.configured', 'Retenção configurada', `mensagens ${r.messagesDays}d, gravações ${r.recordingsDays}d, auditoria ${r.auditDays}d, logs ${r.logsDays}d.`));
  const lastRun = await prisma.bvRetentionRun.findFirst({ where: { orgId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const runAge = lastRun ? (Date.now() - lastRun.createdAt.getTime()) / 3_600_000 : null;
  checks.push(runAge === null ? bad('retention.last_run', 'Retenção nunca executada', 'WARN', 'MEDIUM', 'Nenhuma execução registrada.', 'Confirmar BV_JOBS≠off ou executar POST /security/retention/run.')
    : runAge > 36 ? bad('retention.last_run', 'Retenção atrasada', 'WARN', 'MEDIUM', `Última execução há ${Math.round(runAge)} h.`, 'Verificar o job balcao.security.retention nos logs da API.')
      : ok('retention.last_run', 'Retenção executada nas últimas 36 h', `Última execução há ${Math.round(runAge)} h.`));
  const hold = activeLegalHold(sec.legalHold);
  if (hold) checks.push({ id: 'retention.legal_hold', title: 'Guarda legal ativa', status: 'INFO', severity: 'LOW', detail: `Retenção, anonimização e exclusão suspensas${hold.basis ? ` (${hold.basis})` : ''}.` });

  // backup / DR
  const bk = readBackupStatus();
  if (!env.BV_BACKUP_STATUS_FILE) checks.push(bad('backup.status_file', 'BV_BACKUP_STATUS_FILE não definido', 'WARN', 'HIGH', 'Sem arquivo de status a API não enxerga o backup.', 'Apontar BV_BACKUP_STATUS_FILE para o JSON gerado por infra/backup/pg-backup.sh.'));
  else if (!bk) checks.push(bad('backup.status_file', 'Status de backup ilegível', 'FAIL', 'HIGH', 'Arquivo ausente ou inválido.', 'Rodar infra/backup/pg-backup.sh e conferir o volume montado na API.'));
  else {
    const a = ageH(bk.lastBackupAt);
    checks.push(a === null || bk.lastBackupOk === false ? bad('backup.last', 'Último backup falhou/ausente', 'FAIL', 'CRITICAL', `lastBackupAt=${bk.lastBackupAt ?? 'n/d'} ok=${String(bk.lastBackupOk)}`, 'Ver logs do pg-backup.sh.')
      : a > 48 ? bad('backup.last', 'Backup desatualizado', 'FAIL', 'HIGH', `Último backup há ${Math.round(a)} h.`, 'Verificar cron/timer de backup.')
        : ok('backup.last', 'Backup recente', `Último backup há ${Math.round(a)} h${bk.encrypted === false ? ' (SEM cifra!)' : ' (cifrado)'}; offsite=${String(bk.offsite ?? false)}.`));
    if (bk.encrypted === false) checks.push(bad('backup.encrypted', 'Backup sem criptografia', 'FAIL', 'CRITICAL', 'Status informa encrypted=false.', 'Configurar BV_BACKUP_KEY_FILE (ou age recipient).'));
    const t = ageH(bk.lastRestoreTestAt);
    checks.push(t === null ? bad('backup.restore_test', 'Teste de restauração nunca registrado', 'WARN', 'HIGH', 'Backup sem restore testado não é backup.', 'Agendar infra/backup/pg-restore-test.sh (mensal).')
      : bk.lastRestoreTestOk === false ? bad('backup.restore_test', 'Último teste de restauração falhou', 'FAIL', 'CRITICAL', `Em ${bk.lastRestoreTestAt}.`, 'Investigar e repetir o teste.')
        : t > 24 * 35 ? bad('backup.restore_test', 'Teste de restauração antigo', 'WARN', 'MEDIUM', `Há ${Math.round(t / 24)} dias.`, 'Repetir pg-restore-test.sh.')
          : ok('backup.restore_test', 'Restauração testada', `Há ${Math.round(t / 24)} dia(s); RTO medido ${bk.rtoSeconds ?? 'n/d'} s.`));
  }

  // transporte / proxy
  const proto = String(req?.headers['x-forwarded-proto'] ?? req?.protocol ?? '');
  checks.push(proto === 'https' ? ok('tls.proxy', 'Requisição chegou por HTTPS (proxy)', 'X-Forwarded-Proto=https.')
    : bad('tls.proxy', 'Requisição não indica HTTPS', env.NODE_ENV === 'production' ? 'FAIL' : 'WARN', 'HIGH', `Protocolo observado: ${proto || 'n/d'}.`, 'Servir a API só atrás do nginx com TLS e repassar X-Forwarded-Proto (infra/ha/nginx).'));
  checks.push({ id: 'tls.hsts', title: 'HSTS e cabeçalhos de segurança', status: 'INFO', severity: 'LOW', detail: 'Aplicados no nginx (infra/ha/nginx/balcao.conf). Verificação externa: .github/workflows/tls-expiry.yml e `curl -sI https://<host>/balcao/health`.' });

  // storage
  try {
    const root = storageRoot();
    const st = fs.statSync(root);
    const worldAccess = (st.mode & 0o007) !== 0;
    checks.push(worldAccess ? bad('storage.perms', 'Diretório de storage acessível a "outros"', 'FAIL', 'HIGH', `Modo ${(st.mode & 0o777).toString(8)}.`, 'chmod 750 no BV_STORAGE_DIR.') : ok('storage.perms', 'Permissões do storage', `Modo ${(st.mode & 0o777).toString(8)}.`));
  } catch { checks.push(bad('storage.perms', 'Diretório de storage inexistente', 'WARN', 'MEDIUM', 'Ainda não criado (nenhum arquivo gravado) ou BV_STORAGE_DIR incorreto.', 'Criar o diretório com modo 750 e montar volume persistente.')); }

  // auditoria imutável
  try {
    const t = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_trigger WHERE tgrelid = '"BvAuditLog"'::regclass AND NOT tgisinternal AND tgname = 'bv_audit_no_update'`;
    checks.push(Number(t[0]?.n) > 0 ? ok('audit.append_only', 'Trilha de auditoria imutável (trigger)', 'UPDATE bloqueado no banco.') : bad('audit.append_only', 'Trigger de imutabilidade ausente', 'FAIL', 'HIGH', 'bv_audit_no_update não encontrado.', 'Reaplicar a migration do Balcão.'));
  } catch { checks.push({ id: 'audit.append_only', title: 'Trilha de auditoria imutável', status: 'INFO', severity: 'LOW', detail: 'Não foi possível consultar pg_trigger.' }); }

  // residência de dados (atestação operacional)
  checks.push(env.BV_DATA_RESIDENCY === 'BR' ? ok('residency.declared', 'Residência de dados declarada: Brasil', 'BV_DATA_RESIDENCY=BR (atestação do operador; não é prova técnica).')
    : bad('residency.declared', 'Residência de dados não declarada', 'WARN', 'MEDIUM', 'BV_DATA_RESIDENCY≠BR.', 'Confirmar que banco, storage, backup e LLM estão em território nacional e declarar BV_DATA_RESIDENCY=BR (ver INFRA-BR-CERTIFICACOES.md).'));

  // LGPD e incidentes
  const overdue = await prisma.bvDataSubjectRequest.count({ where: { orgId, status: 'OPEN', requestedAt: { lt: new Date(Date.now() - 15 * 86_400_000) } } });
  checks.push(overdue ? bad('lgpd.dsr_overdue', 'Solicitações de titulares vencidas', 'FAIL', 'HIGH', `${overdue} aberta(s) há mais de 15 dias (LGPD art. 19, II).`, 'Tratar em GET /security/dsr?status=OPEN.') : ok('lgpd.dsr_overdue', 'Solicitações de titulares em dia', 'Nenhuma aberta há mais de 15 dias.'));
  const inc = (await listIncidents(orgId)).filter((i) => i.status !== 'CLOSED' && !i.notifiedAt);
  const late = inc.filter((i) => Date.parse(i.deadlineAt) < Date.now());
  checks.push(late.length ? bad('incident.deadline', 'Incidente com prazo de 24 h vencido', 'FAIL', 'CRITICAL', `${late.length} incidente(s) sem comunicação ao contratante.`, 'Comunicar o TJTO e registrar notifiedAt (PATCH /security/incidents/:id).')
    : inc.length ? bad('incident.deadline', 'Incidentes aguardando comunicação', 'WARN', 'HIGH', `${inc.length} incidente(s) dentro do prazo de 24 h.`, 'Comunicar o contratante e registrar notifiedAt.') : ok('incident.deadline', 'Sem incidente pendente de comunicação', 'Nenhum.'));

  const summary = { OK: 0, WARN: 0, FAIL: 0, INFO: 0 } as Record<CheckStatus, number>;
  for (const c of checks) summary[c.status]++;
  const scored = checks.filter((c) => c.status !== 'INFO');
  const score = scored.length ? Math.round(((summary.OK + summary.WARN * 0.5) / scored.length) * 100) : 100;
  return { generatedAt: new Date().toISOString(), summary, score, checks };
}
