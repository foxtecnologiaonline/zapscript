/**
 * Código-fonte do widget embarcável (JS puro, sem dependências, tipos via JSDoc). Mantido como string para
 * entrar no `tsc` sem etapa de cópia de assets — NÃO usar crases nem "${" dentro do script.
 * Servido por GET /balcao/webchat/widget.js (index.ts).
 */
const SOURCE = String.raw`/*! Balcão Virtual — widget de atendimento (webchat) v1.1.0 | JS puro, sem dependências */
(function () {
  'use strict';
  var doc = document, win = window;
  if (win.__bvWebchat) return;
  /** @type {HTMLScriptElement|null} */
  var me = /** @type {any} */ (doc.currentScript) || doc.querySelector('script[data-org][src*="widget.js"]');
  if (!me || !win.fetch || !Element.prototype.attachShadow) return;
  var org = (me.getAttribute('data-org') || '').trim();
  if (!org) { console.warn('[Balcão Virtual] atributo data-org ausente'); return; }
  win.__bvWebchat = true;

  /** @typedef {{id:string,from:string,kind:string,text:?string,attachments:Array<{name:string,mime:string,size:number,path:string}>,at:string}} Msg */
  /** @typedef {{status:string,protocol:?string,csat:{requested:boolean,done:boolean,prompt:string}}} State */

  var u = new URL(me.src, location.href);
  var API = u.origin + u.pathname.replace(/\/widget\.js$/, '') + '/public';
  var WSURL = u.origin.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
  var KEY = 'bv.wc.token.' + org, PKEY = 'bv.wc.prefs';

  var L = {
    'pt-BR': {
      open: 'Abrir atendimento', close: 'Fechar atendimento', chat: 'Atendimento', start: 'Iniciar conversa', name: 'Nome (opcional)', email: 'E-mail (opcional)',
      startHint: 'Informar nome e e-mail é opcional; ajuda o atendente a retornar o contato.', msg: 'Digite sua mensagem', send: 'Enviar', leave: 'Deixar mensagem',
      attach: 'Anexar arquivo', human: 'Falar com atendente humano', video: 'Atendimento por vídeo', end: 'Encerrar atendimento', confirmEnd: 'Confirmar encerramento',
      fontUp: 'Aumentar letra', fontDown: 'Diminuir letra', contrast: 'Alto contraste', you: 'Você', bot: 'Assistente virtual', agent: 'Atendente', system: 'Sistema',
      typing: 'O atendente está digitando…', sending: 'Enviando…', sendErr: 'Não foi possível enviar. Tente novamente.', sessErr: 'Não foi possível iniciar o atendimento. Tente novamente.',
      net: 'Sem conexão com o servidor de atendimento.', rate: 'Muitas ações em pouco tempo. Aguarde um instante.', expired: 'Sua sessão expirou. Inicie um novo atendimento.',
      waiting: 'Você está na fila. Um atendente irá atendê-lo em breve.', active: 'Você está em atendimento com um atendente.', closed: 'Atendimento encerrado.',
      humanAsked: 'Pedido enviado. Aguarde um atendente humano.', videoOk: 'Sala de vídeo criada. O link foi enviado na conversa.', nps: 'Avalie o atendimento',
      npsLow: '0 = nada provável', npsHigh: '10 = muito provável', npsPick: 'Selecione uma nota de 0 a 10.', npsComment: 'Comentário (opcional)', npsSend: 'Enviar avaliação',
      npsSkip: 'Agora não', thanks: 'Obrigado! Seu atendimento foi finalizado.', again: 'Novo atendimento', big: 'Arquivo muito grande (máximo {n} MB).',
      type: 'Tipo não permitido. Envie imagem (PNG, JPG, WEBP, GIF) ou PDF.', sent: 'Arquivo enviado.', proto: 'Protocolo', hint: 'Enter envia; Shift+Enter cria nova linha.',
      newMsg: 'nova mensagem', download: 'Baixar', notice: 'Aviso de privacidade e uso de IA',
      captions: 'Legendas', capOn: 'Legendas ativadas.', capOff: 'Legendas desativadas.', capPriv: 'A captura da sua fala usa o reconhecimento de voz do navegador, que pode enviar o áudio ao fornecedor dele.',
      capNoSupport: 'Seu navegador não captura a fala (use Chrome ou Edge). Você ainda verá as legendas do atendente.', capDenied: 'Permissão do microfone negada. Você ainda verá as legendas do atendente.'
    },
    en: {
      open: 'Open support chat', close: 'Close chat', chat: 'Support chat', start: 'Start chat', name: 'Name (optional)', email: 'E-mail (optional)', startHint: 'Name and e-mail are optional.',
      msg: 'Type your message', send: 'Send', leave: 'Leave a message', attach: 'Attach file', human: 'Talk to a human agent', video: 'Video support', end: 'End chat', confirmEnd: 'Confirm end',
      fontUp: 'Larger text', fontDown: 'Smaller text', contrast: 'High contrast', you: 'You', bot: 'Virtual assistant', agent: 'Agent', system: 'System', typing: 'The agent is typing…',
      sending: 'Sending…', sendErr: 'Could not send. Try again.', net: 'No connection to the server.', expired: 'Session expired. Start a new chat.', waiting: 'You are in the queue.',
      captions: 'Captions', capOn: 'Captions on.', capOff: 'Captions off.', active: 'You are talking to an agent.', closed: 'Chat ended.', nps: 'Rate this support', npsSend: 'Submit rating', npsSkip: 'Not now', thanks: 'Thank you! The chat is finished.', again: 'New chat'
    }
  };
  var T = L['pt-BR'];
  function pickLang(l) { l = String(l || 'pt-BR'); T = Object.assign({}, L['pt-BR'], L[l] || L[l.split('-')[0]] || {}); }
  pickLang(me.getAttribute('data-lang'));

  var CSS = [
    ':host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}',
    '.r{--c:#1f4e9c;--t:#fff;--fs:1;font:calc(16px*var(--fs))/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1a1a1a}',
    'button,input,textarea{font:inherit;color:inherit}',
    'button:focus-visible,input:focus-visible,textarea:focus-visible,.log:focus-visible,a:focus-visible{outline:3px solid #1a1a1a;outline-offset:2px;box-shadow:0 0 0 2px #fff}',
    '.l{position:fixed;bottom:20px;right:20px;z-index:2147483000;min-height:56px;min-width:56px;padding:0 18px;border:2px solid #fff;border-radius:28px;background:var(--c);color:var(--t);cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(0,0,0,.35);font-weight:600}',
    '.left .l{left:20px;right:auto}.l svg{width:24px;height:24px;fill:currentColor}.bd{background:#b3261e;color:#fff;border-radius:10px;min-width:20px;padding:0 6px;font-size:.8em;text-align:center}',
    '.p{position:fixed;bottom:20px;right:20px;z-index:2147483001;width:380px;max-width:calc(100vw - 24px);height:min(620px,calc(100vh - 40px));height:min(620px,calc(100dvh - 40px));display:flex;flex-direction:column;background:#fff;border:2px solid #4d4d4d;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);overflow:hidden}',
    '.left .p{left:20px;right:auto}',
    '@media (max-width:480px){.p,.left .p{inset:0;width:auto;max-width:none;height:auto;border:0;border-radius:0}.l{bottom:12px;right:12px}.left .l{left:12px}}',
    '.h{background:var(--c);color:var(--t);padding:8px 8px 8px 14px;display:flex;align-items:center;gap:4px}.h h2{flex:1;margin:0;font-size:1.1em;line-height:1.25}',
    '.ib{min-width:44px;min-height:44px;border:1px solid transparent;border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-weight:700}.ib:hover,.ib[aria-pressed=true]{background:rgba(255,255,255,.25);border-color:currentColor}',
    '.n{padding:8px 14px;background:#f4f1e3;border-bottom:1px solid #8a7f3a;font-size:.85em;color:#2b2600;margin:0 0 12px}.n p{margin:2px 0}summary{cursor:pointer;font-weight:600;min-height:24px}details.n{margin:0}.fm .n{border:1px solid #8a7f3a;border-radius:8px}',
    '.v{flex:1;min-height:0;display:flex;flex-direction:column}.sc{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}',
    'label,legend{font-weight:600;display:block;margin-bottom:4px}input[type=text],input[type=email],textarea{width:100%;padding:10px;border:2px solid #595959;border-radius:8px;background:#fff;color:#1a1a1a}',
    '.hint{font-size:.85em;color:#404040;margin:4px 0}.pb{min-height:44px;padding:8px 16px;border:2px solid var(--c);border-radius:8px;background:var(--c);color:var(--t);cursor:pointer;font-weight:700}',
    '.sb{min-height:44px;padding:8px 12px;border:2px solid #595959;border-radius:8px;background:#fff;color:#1a1a1a;cursor:pointer}.sb:disabled,.pb:disabled{opacity:.6;cursor:not-allowed}',
    '.log{flex:1 1 120px;min-height:80px;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#fafafa}',
    '.m{max-width:88%;padding:8px 12px;border-radius:12px;border:1px solid #767676;background:#eef1f6;overflow-wrap:anywhere;white-space:pre-wrap}.m a{color:#0b4fa8}',
    '.m .w{font-size:.78em;font-weight:700;display:block;color:#333}.m-visitor{align-self:flex-end;background:var(--c);color:var(--t);border-color:var(--c)}.m-visitor .w,.m-visitor a{color:var(--t)}',
    '.m-system{align-self:center;background:#fff7d6;border-color:#8a7f3a}.m-bot{background:#e7f2ea}.m img{max-width:100%;border-radius:6px;display:block;margin-top:6px}',
    '.sb[aria-pressed=true]{background:var(--c);color:var(--t);border-color:var(--c)}.cap{margin:0 12px 6px;padding:6px 10px;border:2px solid #595959;border-radius:8px;background:#fff;font-size:.9em;max-height:8em;overflow:auto}.cap p{margin:0 0 2px}.cap .li{font-style:italic;min-height:0}',
    '.ty{min-height:1.4em;padding:0 14px;font-size:.85em;color:#333;font-style:italic}.st{padding:4px 14px;font-size:.9em;color:#1a1a1a;min-height:1.5em}.er{padding:4px 14px;font-size:.9em;color:#9b1c13;font-weight:700}',
    '.ac{display:flex;flex-wrap:wrap;gap:6px;padding:6px 12px;border-top:1px solid #bbb}.ac .sb{flex:1 1 45%;min-width:0;font-size:.82em;min-height:36px;padding:4px 8px}',
    '.cp{display:flex;gap:6px;padding:8px 12px 12px;border-top:1px solid #bbb;align-items:flex-end}.cp textarea{resize:none;min-height:44px;max-height:120px}',
    '.ns{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.ns label{margin:0;font-weight:400}.ns input{position:absolute;opacity:0;width:1px;height:1px}',
    '.ns span{display:inline-block;min-width:36px;min-height:36px;line-height:32px;text-align:center;border:2px solid #595959;border-radius:6px;background:#fff;cursor:pointer}',
    '.ns input:checked+span{background:var(--c);color:var(--t);border-color:var(--c);font-weight:700}.ns input:focus-visible+span{outline:3px solid #1a1a1a;outline-offset:2px;box-shadow:0 0 0 2px #fff}',
    '.fm{padding:14px;overflow:auto}.fm .f{margin-bottom:12px}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.hc .p,.hc .log,.hc .cap,.hc .n,.hc summary,.hc .m,.hc .sb,.hc input[type=text],.hc input[type=email],.hc textarea,.hc .ns span{background:#000;color:#fff;border-color:#fff}',
    '.hc .h,.hc .l,.hc .pb,.hc .m-visitor,.hc .ns input:checked+span{background:#ffeb3b;color:#000;border-color:#fff}.hc .m a{color:#ffeb3b}.hc .m-visitor a,.hc .m-visitor .w,.hc .h *{color:#000}',
    '.hc .m .w,.hc .hint,.hc .ty,.hc .st{color:#fff}.hc .er{color:#ff8a80}.hc .m{border-width:2px}',
    '@media (prefers-reduced-motion:no-preference){.p{animation:bvin .18s ease-out}@keyframes bvin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}',
    '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}'
  ].join('');

  // ── utilidades ───────────────────────────────────────────────────────────────
  function sget(k, s) { try { return (s ? localStorage : sessionStorage).getItem(k); } catch (e) { return null; } }
  function sset(k, v, s) { try { var st = s ? localStorage : sessionStorage; if (v == null) st.removeItem(k); else st.setItem(k, v); } catch (e) { /* storage indisponível */ } }
  function h(tag, a, kids) {
    var e = doc.createElement(tag);
    for (var k in a || {}) {
      var v = a[k];
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return e;
  }
  function uid() { var a = new Uint8Array(12); (win.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function lum(hex) { var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function ink(hex) { var l = lum(hex); return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? '#ffffff' : '#000000'; }
  function linkify(el, text) {
    var re = /https?:\/\/[^\s<>"']+/g, last = 0, m;
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[.,;:!?)]+$/, '');
      el.appendChild(doc.createTextNode(text.slice(last, m.index)));
      el.appendChild(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
      last = m.index + url.length; re.lastIndex = last;
    }
    el.appendChild(doc.createTextNode(text.slice(last)));
  }

  // ── estado ───────────────────────────────────────────────────────────────────
  var cfg = null, tok = sget(KEY), seen = {}, since = null, st = /** @type {State} */ ({ status: 'none', protocol: null, csat: { requested: false, done: false, prompt: '' } });
  var isOpen = false, unread = 0, lastStatus = '', pendingId = null, busy = false, pollT = null, typT = null, lastTyping = 0, endArmed = false;
  var ws = null, sockUp = false, sockTry = 0, el = {}, capOn = false, rec = null, lastCap = 0;
  var prefs = {}; try { prefs = JSON.parse(sget(PKEY, true) || '{}') || {}; } catch (e) { prefs = {}; }
  if (prefs.hc == null && win.matchMedia && matchMedia('(prefers-contrast: more)').matches) prefs.hc = true;

  // ── rede ─────────────────────────────────────────────────────────────────────
  /** @returns {Promise<{ok:boolean,status:number,data:any}>} */
  function api(method, path, body, form) {
    var headers = {}, init = { method: method, headers: headers, mode: 'cors', credentials: 'omit' };
    if (tok) headers['X-Visitor-Token'] = tok;
    if (form) init.body = form; else if (body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    if (win.AbortController) { var ctl = new AbortController(); init.signal = ctl.signal; setTimeout(function () { ctl.abort(); }, 20000); }
    return fetch(API + path, init).then(function (r) {
      return r.text().then(function (t) { var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { /* corpo não-JSON */ } return { ok: r.ok, status: r.status, data: d }; });
    }, function () { return { ok: false, status: 0, data: null }; });
  }
  function errText(r, fb) {
    if (r.status === 0) return T.net;
    if (r.status === 429) return T.rate;
    return (r.data && r.data.error && r.data.error.message) || fb;
  }
  function expire() { if (capOn) capToggle(false); tok = null; sset(KEY, null); seen = {}; since = null; st.status = 'none'; closeSock(); el.log.textContent = ''; showView('start'); say(T.expired, true); }

  // ── Socket.IO mínimo (Engine.IO v4 sobre WebSocket) com fallback para polling ─
  function sockOpen() {
    if (!tok || ws || sockTry > 6 || !win.WebSocket) return;
    var s;
    try { s = ws = new WebSocket(WSURL); } catch (e) { ws = null; return; }
    s.onmessage = function (ev) {
      var d = String(ev.data), t = d.charAt(0);
      if (t === '0') s.send('40/bv-visitor,' + JSON.stringify({ token: tok }));
      else if (t === '2') s.send('3');
      else if (t === '4' && d.charAt(1) === '0') { sockUp = true; sockTry = 0; schedule(); }
      else if (t === '4' && d.charAt(1) === '4') { sockTry = 99; s.close(); }
      else if (t === '4' && d.charAt(1) === '2') {
        var m = /^\/bv-visitor,\d*(\[[\s\S]*\])$/.exec(d.slice(2));
        if (m) { try { var p = JSON.parse(m[1]); onEvent(p[0], p[1] || {}); } catch (e) { /* pacote inválido */ } }
      }
    };
    s.onclose = function () { if (ws === s) { ws = null; sockUp = false; schedule(); if (tok && ++sockTry <= 6) setTimeout(sockOpen, Math.min(30000, 1000 * Math.pow(2, sockTry))); } };
    s.onerror = function () { try { s.close(); } catch (e) { /* já fechado */ } };
  }
  function closeSock() { var s = ws; ws = null; sockUp = false; sockTry = 0; if (s) try { s.close(); } catch (e) { /* noop */ } }
  function emitSock(ev) { if (ws && sockUp) ws.send('42/bv-visitor,' + JSON.stringify([ev])); }
  function onEvent(ev, d) {
    if (ev === 'message:new' && d.message) addMsg(d.message);
    else if (ev === 'typing') { el.ty.textContent = T.typing; clearTimeout(typT); typT = setTimeout(function () { el.ty.textContent = ''; }, 5000); }
    else if (ev === 'csat:request' || ev === 'conversation:closed') poll();
    else if (ev === 'caption' && d.from === 'AGENT' && typeof d.text === 'string') capLine('AGENT', d.text.slice(0, 500), !!d.final);
  }

  // ── legendas em tempo real (relé efêmero: nada é gravado; a fala é reconhecida pelo navegador — Chrome/Edge) ──
  var SR = win.SpeechRecognition || win.webkitSpeechRecognition;
  function capLine(from, text, final) {
    if (!capOn || !text) return;
    var who = from === 'AGENT' ? T.agent : T.you, live = el.capLive[from === 'AGENT' ? 'a' : 'v'];
    if (!final) { live.textContent = who + ': ' + text; return; }
    live.textContent = '';
    el.capLog.appendChild(h('p', { text: who + ': ' + text }));
    while (el.capLog.childNodes.length > 4) el.capLog.removeChild(el.capLog.firstChild);
    el.cap.scrollTop = el.cap.scrollHeight;
  }
  function capSend(text, final) {
    if (!tok || st.status === 'none' || st.status === 'closed') return;
    var n = Date.now();
    if (!final && n - lastCap < 400) return;
    lastCap = n;
    api('POST', '/caption', { text: text.slice(0, 500), final: !!final }).then(function (r) { if (r.status === 401) expire(); });
  }
  function recStart() {
    if (!SR) { say(T.capNoSupport); return; }
    var r;
    try { r = new SR(); } catch (e) { say(T.capNoSupport); return; }
    r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true;
    r.onresult = function (e) {
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var x = e.results[i], t = x[0] && x[0].transcript ? String(x[0].transcript).trim() : '';
        if (t) { capLine('VISITOR', t, x.isFinal); capSend(t, x.isFinal); }
      }
    };
    r.onerror = function (e) { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { capToggle(false); say(T.capDenied, true); } };
    r.onend = function () { if (capOn && rec === r) { try { r.start(); } catch (e) { /* reinício recusado */ } } };
    rec = r;
    try { r.start(); } catch (e) { rec = null; }
  }
  function capToggle(on) {
    capOn = on; el.capBtn.setAttribute('aria-pressed', String(on)); el.cap.hidden = !on;
    if (!on) {
      var r = rec; rec = null;
      if (r) { r.onend = null; try { r.stop(); } catch (e) { /* já parado */ } }
      el.capLog.textContent = ''; el.capLive.a.textContent = ''; el.capLive.v.textContent = ''; say(T.capOff); return;
    }
    say(SR ? T.capOn + ' ' + T.capPriv : T.capOn); recStart();
  }

  // ── polling ──────────────────────────────────────────────────────────────────
  function schedule() {
    clearTimeout(pollT);
    if (!tok) return;
    pollT = setTimeout(poll, sockUp ? 25000 : (doc.hidden ? 10000 : 3500));
  }
  function poll() {
    clearTimeout(pollT);
    if (!tok) return Promise.resolve();
    return api('GET', '/messages' + (since ? '?since=' + encodeURIComponent(since) : '')).then(function (r) {
      if (r.status === 401) return expire();
      if (r.ok && r.data) { (r.data.messages || []).forEach(addMsg); applyState(r.data.state); }
      schedule();
    });
  }

  // ── mensagens ────────────────────────────────────────────────────────────────
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function fetchBlob(path) { return fetch(API + '/' + path, { headers: { 'X-Visitor-Token': tok || '' }, mode: 'cors', credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('x'); return r.blob(); }); }
  function addMsg(/** @type {Msg} */ m) {
    if (!m || !m.id || seen[m.id]) return;
    seen[m.id] = 1;
    if (m.from !== 'visitor' && (!since || m.at > since)) since = m.at;
    var who = m.from === 'visitor' ? T.you : (T[m.from] || T.system), body = h('span');
    if (m.text) linkify(body, m.text);
    (m.attachments || []).forEach(function (a) {
      var box = h('div');
      if (/^image\//.test(a.mime)) {
        fetchBlob(a.path).then(function (b) { box.appendChild(h('img', { src: URL.createObjectURL(b), alt: a.name })); }, function () { /* sem prévia */ });
      }
      box.appendChild(h('button', { type: 'button', class: 'sb', text: T.download + ': ' + a.name + ' (' + fmtSize(a.size) + ')', onclick: function () {
        fetchBlob(a.path).then(function (b) { var l = h('a', { href: URL.createObjectURL(b), download: a.name }); doc.body.appendChild(l); l.click(); l.remove(); }, function () { say(T.net, true); });
      } }));
      body.appendChild(box);
    });
    var t = new Date(m.at), when = isNaN(t) ? '' : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var node = h('div', { class: 'm m-' + m.from }, [h('span', { class: 'w', text: who + (when ? ' · ' + when : '') }), body]);
    var stick = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 80;
    el.log.appendChild(node);
    if (stick || m.from === 'visitor') el.log.scrollTop = el.log.scrollHeight;
    if (m.from !== 'visitor') { el.ty.textContent = ''; if (!isOpen) { unread++; badge(); } }
  }
  function badge() {
    el.bd.textContent = unread ? String(unread) : ''; el.bd.hidden = !unread;
    el.l.setAttribute('aria-label', T.open + (unread ? ' (' + unread + ' ' + T.newMsg + ')' : ''));
  }
  var sayT;
  function say(text, err) { clearTimeout(sayT); el.st.textContent = ''; el.er.textContent = ''; if (!text) return; var n = err ? el.er : el.st; sayT = setTimeout(function () { n.textContent = text; }, 30); }

  function applyState(s) {
    if (!s) return;
    st = s;
    var closed = s.status === 'closed', live = s.status === 'waiting' || s.status === 'active';
    if (s.status !== lastStatus) {
      if (s.status === 'waiting') say(T.waiting); else if (s.status === 'active') say(T.active); else if (closed) say(T.closed);
      lastStatus = s.status;
    }
    el.proto.textContent = s.protocol ? T.proto + ': ' + s.protocol : '';
    if (closed && capOn) capToggle(false);
    el.cp.hidden = closed; el.ac.hidden = closed;
    el.human.disabled = live;
    var nps = closed && s.csat && s.csat.requested && cfg.features.csat;
    el.nps.hidden = !nps; el.done.hidden = !(closed && !nps);
    if (nps) { el.npsQ.textContent = s.csat.prompt || T.nps; }
    if (closed && !nps) el.doneT.textContent = T.thanks;
  }

  // ── ações ────────────────────────────────────────────────────────────────────
  function send() {
    var text = el.ta.value.trim();
    if (!text || busy) return;
    busy = true; el.send.disabled = true; say(T.sending);
    pendingId = pendingId || uid();
    api('POST', '/messages', { text: text, clientMsgId: pendingId }).then(function (r) {
      busy = false; el.send.disabled = false;
      if (r.status === 401) return expire();
      if (!r.ok) return say(errText(r, T.sendErr), true);
      pendingId = null; el.ta.value = ''; el.ta.style.height = 'auto'; say('');
      addMsg(r.data.message); applyState(r.data.state); el.ta.focus();
    });
  }
  function typing() {
    var n = Date.now();
    if (n - lastTyping < 3000 || !tok) return;
    lastTyping = n;
    if (sockUp) emitSock('typing'); else api('POST', '/typing');
  }
  function upload(file) {
    if (!file) return;
    var max = cfg.attachments.maxBytes;
    if (file.size > max) return say(T.big.replace('{n}', Math.round(max / 1048576)), true);
    if (cfg.attachments.types.indexOf(file.type) < 0) return say(T.type, true);
    var fd = new FormData(); fd.append('text', el.ta.value.trim().slice(0, 500)); fd.append('file', file, file.name);
    say(T.sending);
    api('POST', '/attachments', null, fd).then(function (r) {
      if (r.status === 401) return expire();
      if (!r.ok) return say(errText(r, T.sendErr), true);
      el.ta.value = ''; say(T.sent); addMsg(r.data.message); applyState(r.data.state);
    });
    el.file.value = '';
  }
  function simple(path, okText, after) {
    api('POST', path, {}).then(function (r) {
      if (r.status === 401) return expire();
      if (!r.ok) return say(errText(r, T.sendErr), true);
      if (okText) say(okText);
      if (r.data && r.data.state) applyState(r.data.state);
      if (after) after(r);
      poll();
    });
  }
  function endChat() {
    if (!endArmed) { endArmed = true; el.end.textContent = T.confirmEnd; el.end.focus(); setTimeout(function () { endArmed = false; el.end.textContent = T.end; }, 6000); return; }
    endArmed = false; el.end.textContent = T.end;
    simple('/end', null, function () { if (st.status === 'closed' && el.nps.hidden) say(T.thanks); });
  }
  function sendNps(skip) {
    var sel = el.nps.querySelector('input:checked');
    if (skip) { leave(); return; }
    if (!sel) return say(T.npsPick, true);
    api('POST', '/csat', { score: Number(sel.value), comment: el.npsC.value.trim() || undefined }).then(function (r) {
      if (r.status === 401) return expire();
      if (!r.ok && r.status !== 409) return say(errText(r, T.sendErr), true);
      leave(true);
    });
  }
  function leave(thanks) {
    if (capOn) capToggle(false);
    api('POST', '/end', { leave: true }).then(function () {
      tok = null; sset(KEY, null); closeSock(); clearTimeout(pollT); seen = {}; since = null; lastStatus = '';
      el.log.textContent = ''; el.nps.hidden = true; el.done.hidden = true; showView('start');
      if (thanks) say(T.thanks);
    });
  }

  // ── interface ────────────────────────────────────────────────────────────────
  function showView(v) {
    el.start.hidden = v !== 'start'; el.chat.hidden = v !== 'chat';
    if (v === 'chat') { el.cp.hidden = false; el.ac.hidden = false; el.ta.focus(); }
    else if (isOpen) el.name.focus();
  }
  function setOpen(o) {
    isOpen = o; el.p.hidden = !o; el.l.hidden = o; el.l.setAttribute('aria-expanded', String(o));
    if (o) {
      unread = 0; badge();
      if (tok && el.chat.hidden) resume(); else (el.chat.hidden ? el.name : el.ta).focus();
      if (!tok) el.name.focus();
    } else el.l.focus();
  }
  function resume() {
    api('GET', '/history').then(function (r) {
      if (r.status === 401) { tok = null; sset(KEY, null); showView('start'); return; }
      if (!r.ok) { showView('start'); return; }
      showView('chat'); (r.data.messages || []).forEach(addMsg); applyState(r.data.state);
      sockOpen(); schedule();
    });
  }
  function begin(e) {
    e.preventDefault();
    el.go.disabled = true;
    api('POST', '/session', { org: org, name: el.name.value.trim() || undefined, email: el.email.value.trim() || undefined }).then(function (r) {
      el.go.disabled = false;
      if (!r.ok || !r.data || !r.data.token) return say(errText(r, T.sessErr), true);
      tok = r.data.token; sset(KEY, tok);
      showView('chat');
      addMsg({ id: 'welcome', from: 'bot', kind: 'TEXT', text: cfg.welcome, attachments: [], at: new Date().toISOString() });
      say(''); sockOpen(); schedule();
    });
  }
  function applyPrefs() {
    var fs = [0.9, 1, 1.15, 1.3, 1.5], i = Math.max(0, Math.min(4, prefs.fs == null ? 1 : prefs.fs));
    prefs.fs = i; el.r.style.setProperty('--fs', String(fs[i]));
    el.r.classList.toggle('hc', !!prefs.hc); el.hc.setAttribute('aria-pressed', String(!!prefs.hc));
    sset(PKEY, JSON.stringify(prefs), true);
  }
  function trap(e) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(el.p.querySelectorAll('button,input,textarea,a[href]'), function (x) { return !x.disabled && !x.closest('[hidden]') && x.type !== 'file' && !(x.type === 'radio' && !x.checked && el.nps.querySelector('input:checked')); });
    if (!f.length) return;
    var a = el.root.activeElement, first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (a === first || !el.p.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !el.p.contains(a))) { e.preventDefault(); first.focus(); }
  }

  function build() {
    var color = /^#[0-9a-f]{6}$/i.test(me.getAttribute('data-color') || '') ? me.getAttribute('data-color') : cfg.color;
    var pos = (me.getAttribute('data-position') || cfg.position || 'right').indexOf('left') >= 0 ? 'left' : 'right';
    var host = h('div', { id: 'bv-webchat' }), root = host.attachShadow({ mode: 'open' });
    try { var sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; } catch (e) { root.appendChild(h('style', { text: CSS })); }
    var r = h('div', { class: 'r ' + pos }); el.r = r; el.root = root;
    r.style.setProperty('--c', color); r.style.setProperty('--t', ink(color));
    var title = cfg.title || T.chat;

    el.bd = h('span', { class: 'bd', hidden: true, 'aria-hidden': 'true' });
    var ico = h('span', { 'aria-hidden': 'true' }); ico.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>';
    el.l = h('button', { type: 'button', class: 'l', 'aria-label': T.open, 'aria-expanded': 'false', 'aria-haspopup': 'dialog', 'aria-controls': 'bv-panel', onclick: function () { setOpen(true); } }, [ico, h('span', { text: title }), el.bd]);

    // cabeçalho
    el.hc = h('button', { type: 'button', class: 'ib', 'aria-label': T.contrast, 'aria-pressed': 'false', title: T.contrast, onclick: function () { prefs.hc = !prefs.hc; applyPrefs(); } });
    el.hc.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>';
    var hd = h('div', { class: 'h' }, [h('h2', { id: 'bv-t', text: title }),
      h('button', { type: 'button', class: 'ib', 'aria-label': T.fontDown, title: T.fontDown, text: 'A-', onclick: function () { prefs.fs--; applyPrefs(); } }),
      h('button', { type: 'button', class: 'ib', 'aria-label': T.fontUp, title: T.fontUp, text: 'A+', onclick: function () { prefs.fs++; applyPrefs(); } }), el.hc,
      h('button', { type: 'button', class: 'ib', 'aria-label': T.close, title: T.close, text: '✕', onclick: function () { setOpen(false); } })]);

    // avisos (LGPD / IA / fora do horário)
    function notes() { return [cfg.privacyNotice && h('p', { text: cfg.privacyNotice }), cfg.aiNotice && h('p', { text: cfg.aiNotice })]; }
    var off = !cfg.open && h('p', { class: 'n', role: 'status', text: cfg.offlineMessage || '' });
    var nt = h('details', { class: 'n' }, [h('summary', { text: T.notice })].concat(notes()));
    el.proto = h('div', { class: 'hint' });

    // início
    el.name = h('input', { type: 'text', id: 'bv-n', autocomplete: 'name', maxlength: '80' });
    el.email = h('input', { type: 'email', id: 'bv-e', autocomplete: 'email', maxlength: '160' });
    el.go = h('button', { type: 'submit', class: 'pb', text: cfg.open ? T.start : T.leave });
    el.start = h('form', { class: 'fm', onsubmit: begin }, [h('div', { class: 'n' }, notes()), h('div', { class: 'f' }, [h('label', { for: 'bv-n', text: T.name }), el.name]),
      h('div', { class: 'f' }, [h('label', { for: 'bv-e', text: T.email }), el.email]), h('p', { class: 'hint', text: T.startHint }), el.go]);

    // conversa
    el.log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': T.chat, tabindex: '0' });
    el.ty = h('div', { class: 'ty', 'aria-live': 'off' });
    el.st = h('div', { class: 'st', role: 'status', 'aria-live': 'polite' }); el.er = h('div', { class: 'er', role: 'alert' });
    el.human = h('button', { type: 'button', class: 'sb', text: T.human, hidden: !cfg.features.human, onclick: function () { simple('/human', T.humanAsked); } });
    var vid = h('button', { type: 'button', class: 'sb', text: T.video, hidden: !cfg.features.video, onclick: function () { simple('/video', T.videoOk); } });
    el.end = h('button', { type: 'button', class: 'sb', text: T.end, onclick: endChat });
    el.capBtn = h('button', { type: 'button', class: 'sb', text: T.captions, 'aria-pressed': 'false', onclick: function () { capToggle(!capOn); } });
    el.capLog = h('div', { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' }); el.capLive = { a: h('p', { class: 'li' }), v: h('p', { class: 'li' }) };
    el.cap = h('div', { class: 'cap', role: 'group', 'aria-label': T.captions, hidden: true }, [el.capLog, el.capLive.a, el.capLive.v]);
    el.ac = h('div', { class: 'ac', role: 'group', 'aria-label': T.chat }, [el.human, vid, el.capBtn, el.end]);
    el.ta = h('textarea', { id: 'bv-m', rows: '1', maxlength: String(cfg.maxMessageChars), 'aria-describedby': 'bv-h', oninput: function () { typing(); this.style.height = 'auto'; this.style.height = Math.min(120, this.scrollHeight) + 'px'; },
      onkeydown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } } });
    el.file = h('input', { type: 'file', accept: cfg.attachments.types.join(','), hidden: true, tabindex: '-1', 'aria-hidden': 'true', onchange: function () { upload(this.files && this.files[0]); } });
    el.send = h('button', { type: 'submit', class: 'pb', text: cfg.open ? T.send : T.leave });
    var att = h('button', { type: 'button', class: 'sb', 'aria-label': T.attach, title: T.attach, text: '📎', hidden: !cfg.features.attachments, onclick: function () { el.file.click(); } });
    el.cp = h('form', { class: 'cp', onsubmit: function (e) { e.preventDefault(); send(); } }, [h('label', { for: 'bv-m', class: 'sr', text: T.msg }), att, el.file, el.ta, el.send]);
    var hintEl = h('div', { id: 'bv-h', class: 'sr', text: T.hint });

    // NPS e encerramento
    el.npsQ = h('legend', { text: T.nps });
    var scale = h('div', { class: 'ns' });
    for (var i = 0; i <= 10; i++) scale.appendChild(h('label', {}, [h('input', { type: 'radio', name: 'bv-nps', value: String(i) }), h('span', { text: String(i) })]));
    el.npsC = h('textarea', { id: 'bv-c', rows: '2', maxlength: '500', 'aria-label': T.npsComment, placeholder: T.npsComment });
    el.nps = h('form', { class: 'fm', hidden: true, onsubmit: function (e) { e.preventDefault(); sendNps(false); } }, [h('fieldset', {}, [el.npsQ, h('p', { class: 'hint', text: T.npsLow + ' · ' + T.npsHigh }), scale]),
      el.npsC, h('p', {}, [h('button', { type: 'submit', class: 'pb', text: T.npsSend }), ' ', h('button', { type: 'button', class: 'sb', text: T.npsSkip, onclick: function () { sendNps(true); } })])]);
    el.doneT = h('p', { text: T.thanks });
    el.done = h('div', { class: 'fm', hidden: true }, [el.doneT, h('button', { type: 'button', class: 'pb', text: T.again, onclick: function () { leave(false); } })]);

    el.chat = h('div', { class: 'v', hidden: true }, [nt, el.proto, el.log, el.ty, el.cap, el.nps, el.done, el.ac, el.cp, hintEl]);
    el.p = h('section', { class: 'p', id: 'bv-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bv-t', hidden: true, onkeydown: trap }, [hd, off, el.start, el.chat, el.st, el.er]);
    r.appendChild(el.l); r.appendChild(el.p); root.appendChild(r); doc.body.appendChild(host);
    applyPrefs(); badge();
    if (me.getAttribute('data-vlibras') === 'true') vlibras();
  }

  function vlibras() {
    if (win.__bvVl) return; win.__bvVl = 1;
    var w = h('div', { vw: true, class: 'enabled' }); w.innerHTML = '<div vw-access-button class="active"></div><div vw-plugin-wrapper><div class="vw-plugin-top-wrapper"></div></div>';
    doc.body.appendChild(w);
    var s = h('script', { src: 'https://vlibras.gov.br/app/vlibras-plugin.js', async: true });
    s.onload = function () { try { new win.VLibras.Widget('https://vlibras.gov.br/app'); } catch (e) { /* VLibras indisponível */ } };
    doc.body.appendChild(s);
  }

  function init() {
    fetch(API + '/config?org=' + encodeURIComponent(org), { mode: 'cors', credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(function (c) {
      cfg = c; if (!me.getAttribute('data-lang')) pickLang(c.lang); build();
    }).catch(function (s) { console.warn('[Balcão Virtual] widget desativado (' + s + ')'); });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
  /* API pública mínima para o site hospedeiro */
  win.BalcaoVirtual = { open: function () { if (el.p) setOpen(true); }, close: function () { if (el.p) setOpen(false); }, version: '1.1.0' };
})();
`;

/**
 * Reduz o tamanho servido sem minificador: remove comentários de bloco (preserva o banner e os tipos JSDoc), linhas só de comentário
 * e a indentação. Seguro porque o script não tem strings multilinha nem "/*" dentro de strings/regex.
 */
export const WIDGET_JS: string = SOURCE
  .replace(/\/\*(?![!*])[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/^[ \t]+/gm, '')
  .replace(/\n{2,}/g, '\n');
