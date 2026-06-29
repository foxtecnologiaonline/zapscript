/**
 * build-cards.js — pipeline de criativos ZapScript
 * 1) Gera variantes de fundo branco (cards/light/*.svg) por remapeamento de cores
 * 2) Renderiza dark  -> png/*.png        (fundo escuro, 1080x1080)
 * 3) Renderiza light -> png-white/*.png   (fundo branco, 1080x1080)
 *
 * Uso: node build-cards.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'cards');
const LIGHT = path.join(SRC, 'light');
const PNG = path.join(ROOT, 'png');
const PNGW = path.join(ROOT, 'png-white');
[LIGHT, PNG, PNGW].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// Remapeamento dark -> light. Ordem importa (mais específico primeiro).
const MAP = [
  ['#0a0f1a', '#ffffff'], // bg base
  ['#08130e', '#f4f7f5'], // bg grad
  ['#0a1f17', '#eef5f1'], // bg grad alt
  ['#0f2a1f', '#ecfdf5'], // painel verde -> menta claro
  ['#1f2937', '#e2e8f0'], // bolha cinza -> cinza claro
  ['#161f2b', '#f1f5f9'], // card painel (14/15) -> cinza muito claro
  ['#121b28', '#e2e8f0'], // barra superior painel -> cinza claro
  ['#0f1722', '#ffffff'], // janela painel (14) -> branco
  ['#f87171', '#ef4444'], // dot vermelho (mantém, só normaliza contraste)
  ['#fbbf24', '#d97706'], // dot/status amarelo -> mais escuro p/ legibilidade no claro
  ['#f0f0f4', '#0f172a'], // texto claro -> quase preto
  ['#e5f5ee', '#065f46'], // texto sobre painel
  ['#cbd5e1', '#334155'], // texto secundário
  ['#9aa3b2', '#64748b'], // muted
  ['#a7c4b5', '#047857'], // transcrição
  ['#6ee7b7', '#059669'], // assinatura
  ['#6b7280', '#94a3b8'], // muted escuro -> muted claro
  // verdes da marca (#10b981 / #34d399) e #06251a (texto sobre botão) ficam.
];

function toLight(svg) {
  let out = svg;
  for (const [from, to] of MAP) out = out.split(from).join(to);
  return out;
}

async function run() {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.svg'));
  for (const f of files) {
    const darkSvg = fs.readFileSync(path.join(SRC, f), 'utf8');
    const lightSvg = toLight(darkSvg);
    fs.writeFileSync(path.join(LIGHT, f), lightSvg);

    const base = f.replace(/\.svg$/, '');
    await sharp(Buffer.from(darkSvg), { density: 144 })
      .resize(1080, 1080).png().toFile(path.join(PNG, base + '.png'));
    await sharp(Buffer.from(lightSvg), { density: 144 })
      .resize(1080, 1080).png().toFile(path.join(PNGW, base + '.png'));
    console.log('OK', base);
  }
  console.log('\nDark  PNG  ->', PNG);
  console.log('White PNG  ->', PNGW);
  console.log('Light SVG  ->', LIGHT);
}
run().catch((e) => { console.error(e); process.exit(1); });
