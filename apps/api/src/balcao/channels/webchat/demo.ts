/**
 * Página de demonstração (PoC): HTML mínimo e acessível que embute o widget do órgão informado em ?org=<slug>.
 * Sem scripts inline (o CSP do servidor só admite 'self'); o slug é validado e escapado.
 */
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function demoHtml(opts: { org: string | null; vlibras: boolean; position: 'left' | 'right'; widgetPath: string }): string {
  const org = opts.org && SLUG_RE.test(opts.org) ? opts.org : null;
  const widget = org
    ? `<script src="${esc(opts.widgetPath)}" data-org="${esc(org)}" data-position="${opts.position}"${opts.vlibras ? ' data-vlibras="true"' : ''} async></script>`
    : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demonstração do atendimento — Balcão Virtual</title>
<meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;margin:0;color:#1a1a1a;background:#fff}
@media (prefers-color-scheme:dark){body{color:#f2f2f2;background:#121212}a{color:#9ec5ff}}
a.skip{position:absolute;left:-999px;top:0;background:#000;color:#fff;padding:.75rem 1rem;z-index:10}
a.skip:focus{left:0}
header,main,footer{max-width:46rem;margin:0 auto;padding:1rem}
h1{font-size:1.6rem}
code{background:rgba(127,127,127,.2);padding:.1rem .35rem;border-radius:4px}
pre{overflow:auto;background:rgba(127,127,127,.15);padding:1rem;border-radius:6px}
:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}
</style>
</head>
<body>
<a class="skip" href="#conteudo">Ir para o conteúdo</a>
<header><p><strong>Balcão Virtual</strong> — página de demonstração</p></header>
<main id="conteudo">
<h1>Atendimento por chat no site</h1>
${org
    ? `<p>O botão de atendimento aparece no canto inferior ${opts.position === 'left' ? 'esquerdo' : 'direito'} da tela. Ele é totalmente operável pelo teclado (Tab, Enter, Esc) e compatível com leitores de tela.</p>
<p>Órgão em demonstração: <code>${esc(org)}</code>.</p>`
    : `<p>Informe o órgão na URL: <code>?org=&lt;slug&gt;</code>. Parâmetros opcionais: <code>vlibras=1</code> (Libras) e <code>position=left</code>.</p>`}
<h2>Como instalar no seu site</h2>
<pre><code>&lt;script src="https://SEU-SERVIDOR/balcao/webchat/widget.js" data-org="${esc(org ?? 'slug-do-orgao')}" async&gt;&lt;/script&gt;</code></pre>
</main>
<footer><p>Esta página é apenas para demonstração e não coleta dados além do atendimento iniciado pelo visitante.</p></footer>
${widget}
</body>
</html>
`;
}
