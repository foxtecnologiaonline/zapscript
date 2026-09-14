/**
 * ZapWidget — script embutível, plug-and-play.
 *
 * Uso no site do cliente (poucas linhas, sem build step):
 *   <script src="https://SEU-DOMINIO/widget.js" data-key="PUBLIC_KEY" async></script>
 *
 * `data-key` é a publicKey do Client (não secreta — só identifica pra qual
 * conta as conversas vão, como o "site ID" de qualquer widget de chat).
 * A URL base da API é deduzida do próprio <script src>, então o mesmo
 * arquivo funciona em qualquer domínio de cliente sem reconfiguração.
 */
(function () {
  'use strict';

  var scriptEl = document.currentScript;
  if (!scriptEl) return;

  var PUBLIC_KEY = scriptEl.getAttribute('data-key');
  if (!PUBLIC_KEY) {
    console.error('[ZapWidget] data-key ausente no <script>. Widget não iniciado.');
    return;
  }
  var COLOR = scriptEl.getAttribute('data-color') || '#25D366';
  var POSITION = scriptEl.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var API_BASE = new URL(scriptEl.src).origin;
  var POLL_MS = 4000;

  var VISITOR_KEY = 'zw_visitor_' + PUBLIC_KEY;
  var CONTACT_KEY = 'zw_contact_' + PUBLIC_KEY;

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'v-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function getVisitorId() {
    var id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  }

  function getContact() {
    try {
      return JSON.parse(localStorage.getItem(CONTACT_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function setContact(contact) {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
  }

  async function api(path, opts) {
    var res = await fetch(API_BASE + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    if (!res.ok) throw new Error('zapwidget_api_error_' + res.status);
    return res.json();
  }

  // ── UI (Shadow DOM — isola CSS do site hospedeiro) ─────────────────────
  var host = document.createElement('div');
  host.id = 'zapwidget-host';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '.zw-bubble { position: fixed; bottom: 20px; ' + POSITION + ': 20px; width: 60px; height: 60px;',
    '  border-radius: 50%; background: ' + COLOR + '; box-shadow: 0 4px 16px rgba(0,0,0,.25);',
    '  display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483000;',
    '  transition: transform .15s ease; }',
    '.zw-bubble:hover { transform: scale(1.06); }',
    '.zw-bubble svg { width: 28px; height: 28px; fill: #fff; }',
    '.zw-panel { position: fixed; bottom: 92px; ' + POSITION + ': 20px; width: 340px; max-width: calc(100vw - 40px);',
    '  height: 480px; max-height: calc(100vh - 140px); background: #fff; border-radius: 12px;',
    '  box-shadow: 0 8px 30px rgba(0,0,0,.25); display: none; flex-direction: column; overflow: hidden;',
    '  font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; z-index: 2147483000; }',
    '.zw-panel.open { display: flex; }',
    '.zw-header { background: ' + COLOR + '; color: #fff; padding: 14px 16px; font-size: 15px; font-weight: 600; }',
    '.zw-body { flex: 1; overflow-y: auto; padding: 12px; background: #f5f6f8; }',
    '.zw-form { padding: 16px; display: flex; flex-direction: column; gap: 10px; }',
    '.zw-form input { padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }',
    '.zw-form button, .zw-send { background: ' + COLOR + '; color: #fff; border: none; border-radius: 8px;',
    '  padding: 10px 14px; font-size: 14px; font-weight: 600; cursor: pointer; }',
    '.zw-msg { max-width: 80%; padding: 8px 12px; border-radius: 10px; margin-bottom: 8px; font-size: 13px; line-height: 1.4; word-wrap: break-word; }',
    '.zw-msg.out { background: ' + COLOR + '; color: #fff; margin-left: auto; border-bottom-right-radius: 2px; }',
    '.zw-msg.in { background: #fff; color: #222; border: 1px solid #e5e5e5; margin-right: auto; border-bottom-left-radius: 2px; }',
    '.zw-inputRow { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #eee; }',
    '.zw-inputRow input { flex: 1; padding: 10px 12px; border: 1px solid #ddd; border-radius: 20px; font-size: 14px; }',
    '.zw-inputRow button { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }',
  ].join('\n');
  root.appendChild(style);

  var bubble = document.createElement('div');
  bubble.className = 'zw-bubble';
  bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.13 2 11.2c0 2.9 1.47 5.48 3.77 7.16L5 22l3.94-1.5c.98.28 2 .43 3.06.43 5.52 0 10-4.13 10-9.73S17.52 2 12 2z"/></svg>';
  root.appendChild(bubble);

  var panel = document.createElement('div');
  panel.className = 'zw-panel';
  panel.innerHTML =
    '<div class="zw-header">Fale conosco</div>' +
    '<div class="zw-body" id="zw-body"></div>' +
    '<div class="zw-inputRow" id="zw-inputRow" style="display:none">' +
    '  <input id="zw-input" type="text" placeholder="Digite sua mensagem..." />' +
    '  <button class="zw-send" id="zw-send">➤</button>' +
    '</div>';
  root.appendChild(panel);

  var bodyEl = panel.querySelector('#zw-body');
  var inputRow = panel.querySelector('#zw-inputRow');
  var open = false;

  bubble.addEventListener('click', function () {
    open = !open;
    panel.classList.toggle('open', open);
    if (open) init();
  });

  var started = false;
  var lastSince = null;
  var pollTimer = null;

  function renderMessage(m) {
    var el = document.createElement('div');
    el.className = 'zw-msg ' + (m.direction === 'in' && m.senderType === 'visitor' ? 'out' : 'in');
    el.textContent = m.body;
    bodyEl.appendChild(el);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function renderForm() {
    bodyEl.innerHTML = '';
    var form = document.createElement('div');
    form.className = 'zw-form';
    form.innerHTML =
      '<input id="zw-name" type="text" placeholder="Seu nome" />' +
      '<input id="zw-phone" type="tel" placeholder="Seu WhatsApp (com DDD)" />' +
      '<button id="zw-start">Iniciar conversa</button>';
    bodyEl.appendChild(form);

    form.querySelector('#zw-start').addEventListener('click', async function () {
      var name = form.querySelector('#zw-name').value.trim();
      var phone = form.querySelector('#zw-phone').value.trim();
      if (!name || phone.replace(/\D/g, '').length < 10) {
        alert('Preencha nome e um WhatsApp válido (com DDD).');
        return;
      }
      setContact({ name: name, phone: phone });
      await startConversation(name, phone);
    });
  }

  async function startConversation(name, phone) {
    try {
      await api('/api/widget/' + PUBLIC_KEY + '/start', {
        method: 'POST',
        body: JSON.stringify({ visitorId: getVisitorId(), name: name, phone: phone }),
      });
      started = true;
      bodyEl.innerHTML = '';
      inputRow.style.display = 'flex';
      poll();
      pollTimer = setInterval(poll, POLL_MS);
    } catch (e) {
      bodyEl.innerHTML = '<div class="zw-msg in">Não foi possível iniciar a conversa. Tente novamente em instantes.</div>';
    }
  }

  async function poll() {
    try {
      var qs = 'visitorId=' + encodeURIComponent(getVisitorId()) + (lastSince ? '&since=' + encodeURIComponent(lastSince) : '');
      var data = await api('/api/widget/' + PUBLIC_KEY + '/messages?' + qs, { method: 'GET' });
      (data.messages || []).forEach(function (m) {
        renderMessage(m);
        lastSince = m.createdAt;
      });
    } catch (e) {
      /* rede instável — tenta de novo no próximo ciclo */
    }
  }

  async function send() {
    var input = panel.querySelector('#zw-input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    renderMessage({ direction: 'in', senderType: 'visitor', body: text });
    try {
      await api('/api/widget/' + PUBLIC_KEY + '/message', {
        method: 'POST',
        body: JSON.stringify({ visitorId: getVisitorId(), text: text }),
      });
    } catch (e) {
      renderMessage({ direction: 'out', senderType: 'system', body: 'Falha ao enviar. Verifique sua conexão.' });
    }
  }

  panel.querySelector('#zw-send').addEventListener('click', send);
  panel.querySelector('#zw-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send();
  });

  function init() {
    if (started) return;
    var contact = getContact();
    if (contact) {
      started = true;
      inputRow.style.display = 'flex';
      startConversation(contact.name, contact.phone);
    } else {
      renderForm();
    }
  }
})();
