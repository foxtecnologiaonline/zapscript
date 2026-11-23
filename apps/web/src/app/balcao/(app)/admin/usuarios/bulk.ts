/** Leitura e validação do CSV de cadastro em massa: `email,nome,perfil,habilidades;separadas,setor`. */
export const ROLES = ['ATENDENTE', 'SUPERVISOR', 'ADMIN', 'FISCAL'] as const;
export type RoleKey = (typeof ROLES)[number];
export const BULK_MAX = 500;

/** Divide texto CSV em linhas/células (aspas duplas, delimitador `,` ou `;` detectado na 1ª linha). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ROLE_ALIASES: Record<string, RoleKey> = {
  atendente: 'ATENDENTE', supervisor: 'SUPERVISOR', admin: 'ADMIN', administrador: 'ADMIN', fiscal: 'FISCAL', 'fiscal do contrato': 'FISCAL',
};
export const parseRole = (s: string): RoleKey | null => ROLE_ALIASES[strip(s)] ?? null;

export interface BulkRow {
  /** Número da linha no arquivo/texto colado (1 = primeira linha, contando o cabeçalho). */
  line: number;
  email: string; name: string; roleRaw: string; role: RoleKey | null; skills: string[]; sectorRaw: string;
  sectorId?: string; sectorName?: string;
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseBulk(text: string, sectors: Array<{ id: string; name: string }>): { rows: BulkRow[]; hadHeader: boolean } {
  const table = parseCsv(text);
  let start = 0; let hadHeader = false;
  if (table[0] && /^e-?mail$/.test(strip(table[0][0] ?? ''))) { start = 1; hadHeader = true; }
  const seen = new Set<string>();
  const rows: BulkRow[] = [];
  for (let i = start; i < table.length; i++) {
    const [email = '', name = '', roleRaw = '', skillsRaw = '', sectorRaw = ''] = table[i];
    const errors: string[] = [];
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em) || em.length > 200) errors.push('E-mail inválido.');
    else if (seen.has(em)) errors.push('E-mail repetido nesta carga.');
    seen.add(em);
    if (name.length < 2 || name.length > 120) errors.push('Nome deve ter de 2 a 120 caracteres.');
    const role = parseRole(roleRaw);
    if (!role) errors.push('Perfil inválido (use ATENDENTE, SUPERVISOR, ADMIN ou FISCAL).');
    const skills = [...new Set(skillsRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean))];
    if (skills.length > 30 || skills.some((s) => s.length > 50)) errors.push('Habilidades: no máximo 30, de até 50 caracteres.');
    let sectorId: string | undefined; let sectorName: string | undefined;
    if (sectorRaw) {
      const byId = sectors.find((s) => s.id === sectorRaw);
      const byName = sectors.find((s) => strip(s.name) === strip(sectorRaw));
      if (byId) sectorId = byId.id; else if (byName) sectorId = byName.id; else errors.push(`Setor "${sectorRaw}" não existe (cadastre-o na aba Setores).`);
    }
    rows.push({ line: i + 1, email: em, name, roleRaw, role, skills, sectorRaw, sectorId, sectorName, errors });
  }
  return { rows, hadHeader };
}

export const BULK_TEMPLATE = 'email,nome,perfil,habilidades,setor\nmaria.silva@exemplo.jus.br,Maria Silva,ATENDENTE,civel;juizado,Balcão Cível\njoao.souza@exemplo.jus.br,João Souza,SUPERVISOR,,\n';
