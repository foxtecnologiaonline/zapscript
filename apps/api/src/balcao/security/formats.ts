/** Serializadores por formato para a exportação integral (JSON, CSV, XML, SQL), em streaming linha a linha. */
export type ExportFormat = 'JSON' | 'CSV' | 'XML' | 'SQL';
export const FORMAT_EXT: Record<ExportFormat, string> = { JSON: 'json', CSV: 'csv', XML: 'xml', SQL: 'sql' };

export interface ColumnDef { name: string; type: string; list?: boolean }

const plain = (v: unknown): unknown => {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  return v;
};
export const jsonReplacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const p = plain(v);
  const s = typeof p === 'object' ? JSON.stringify(p, jsonReplacer) : String(p);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const xmlEscape = (s: string): string => s.replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Literal SQL de uma linha só (E'' quando há \, \n, \r ou aspas; NUL removido). */
export function sqlString(s: string): string {
  const t = s.replace(/\0/g, '');
  if (!/[\\\n\r']/.test(t)) return `'${t}'`;
  return `E'${t.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

export function sqlValue(v: unknown, col: ColumnDef): string {
  if (v === null || v === undefined) return 'NULL';
  if (col.list) {
    const arr = Array.isArray(v) ? v : [];
    return arr.length ? `ARRAY[${arr.map((x) => sqlString(String(x))).join(',')}]::text[]` : `'{}'::text[]`;
  }
  switch (col.type) {
    case 'Int': case 'Float': case 'Decimal': case 'BigInt': return String(v);
    case 'Boolean': return v ? 'true' : 'false';
    case 'DateTime': return `'${(v instanceof Date ? v : new Date(String(v))).toISOString()}'::timestamp`;
    case 'Json': return `${sqlString(JSON.stringify(v, jsonReplacer))}::jsonb`;
    default: return sqlString(String(v));
  }
}

export interface RowFormatter { head(): string; row(r: Record<string, unknown>): string; tail(): string }

export function makeFormatter(format: ExportFormat, entity: string, table: string, cols: ColumnDef[]): RowFormatter {
  let n = 0;
  switch (format) {
    case 'JSON':
      return {
        head: () => '[\n',
        row: (r) => `${n++ ? ',\n' : ''}${JSON.stringify(Object.fromEntries(cols.map((c) => [c.name, r[c.name] ?? null])), jsonReplacer)}`,
        tail: () => '\n]\n',
      };
    case 'CSV':
      return { head: () => cols.map((c) => csvCell(c.name)).join(',') + '\r\n', row: (r) => cols.map((c) => csvCell(r[c.name])).join(',') + '\r\n', tail: () => '' };
    case 'XML':
      return {
        head: () => `<?xml version="1.0" encoding="UTF-8"?>\n<table name="${xmlEscape(entity)}">\n`,
        row: (r) => '  <row>' + cols.map((c) => {
          const v = r[c.name];
          if (v === null || v === undefined) return `<${c.name} nil="true"/>`;
          const p = plain(v);
          return `<${c.name}>${xmlEscape(typeof p === 'object' ? JSON.stringify(p, jsonReplacer) : String(p))}</${c.name}>`;
        }).join('') + '</row>\n',
        tail: () => '</table>\n',
      };
    case 'SQL': {
      const names = cols.map((c) => `"${c.name}"`).join(', ');
      return {
        head: () => `-- Dump lógico da tabela "${table}" (entidade ${entity}). Uma instrução INSERT por linha.\n`,
        row: (r) => `INSERT INTO "${table}" (${names}) VALUES (${cols.map((c) => sqlValue(r[c.name], c)).join(', ')});\n`,
        tail: () => '',
      };
    }
  }
}
