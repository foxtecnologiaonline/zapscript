#!/usr/bin/env node
/**
 * Renderiza templates `*.tpl` com variáveis de ambiente.
 *   {{VAR}}            → valor (erro se vazio e sem padrão)
 *   {{VAR|padrão}}     → valor ou padrão
 *   ;#if VAR           → mantém o bloco se VAR não for vazio
 *   ;#if VAR=valor     → mantém o bloco se VAR == valor
 *   ;#if !VAR          → mantém se VAR vazio        ;#endif fecha
 * Uso: node render.js <dir-templates> <dir-saida>   (arquivo `x.conf.tpl` → `x.conf`)
 */
const fs = require('fs');
const path = require('path');

function renderTemplate(text, env = process.env, file = 'template') {
  const out = [];
  const stack = [true];
  for (const line of text.split('\n')) {
    const m = /^\s*;#if\s+(!?)([A-Z0-9_]+)(?:=(.*))?\s*$/.exec(line);
    if (m) {
      const v = env[m[2]] || '';
      let ok = m[3] !== undefined ? v === m[3].trim() : v !== '';
      if (m[1]) ok = !ok;
      stack.push(stack[stack.length - 1] && ok);
      continue;
    }
    if (/^\s*;#endif\s*$/.test(line)) { if (stack.length > 1) stack.pop(); continue; }
    if (!stack[stack.length - 1]) continue;
    out.push(line.replace(/\{\{([A-Z0-9_]+)(?:\|([^}]*))?\}\}/g, (_x, name, def) => {
      const v = env[name];
      if (v !== undefined && v !== '') return v;
      if (def !== undefined) return def;
      throw new Error(`${file}: variável ${name} obrigatória não definida`);
    }));
  }
  return out.join('\n');
}

module.exports = { renderTemplate };

if (require.main === module) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) { console.error('uso: render.js <templates> <saida>'); process.exit(2); }
  try {
    for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.tpl'))) {
      const text = fs.readFileSync(path.join(src, f), 'utf8');
      fs.writeFileSync(path.join(dst, f.replace(/\.tpl$/, '')), renderTemplate(text, process.env, f), { mode: 0o640 });
    }
  } catch (err) { console.error(`render: ${err.message}`); process.exit(1); }
}
