#!/usr/bin/env node
/**
 * Gera os endpoints PJSIP (WebRTC) dos atendentes — um por ramal da faixa BV_AGENT_EXT_START..BV_AGENT_EXT_END.
 * Senha derivada: HMAC-SHA256(BV_SIP_SECRET, ramal) em base64url, truncada em 24 caracteres.
 * A API calcula a MESMA derivação (apps/api/src/balcao/channels/voice/sip.ts) ao entregar as credenciais ao softphone.
 *
 * Uso:  BV_SIP_SECRET=... BV_AGENT_EXT_START=1001 BV_AGENT_EXT_END=1050 [BV_TEST_CALLER_EXT=9001] node gen-agents.js [arquivo-de-saida]
 * Sem arquivo de saída, escreve na saída padrão. Nenhum segredo é impresso além do que vai ao arquivo gerado.
 */
const crypto = require('crypto');
const fs = require('fs');

const PASSWORD_LENGTH = 24;

function derivePassword(secret, ext) {
  return crypto.createHmac('sha256', secret).update(String(ext)).digest('base64url').slice(0, PASSWORD_LENGTH);
}

function renderAgent(ext, secret, codecs, transport) {
  return `; ramal ${ext}
[${ext}]
type=endpoint
transport=${transport}
context=agents
disallow=all
allow=${codecs}
webrtc=yes
auth=${ext}
aors=${ext}
callerid="Atendente ${ext}" <${ext}>
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733
media_encryption=dtls
dtls_auto_generate_cert=yes

[${ext}]
type=auth
auth_type=userpass
username=${ext}
password=${derivePassword(secret, ext)}

[${ext}]
type=aor
max_contacts=1
remove_existing=yes
qualify_frequency=30
`;
}

/**
 * Ramal de TESTE que simula o tronco (telefone SIP comum, UDP/TCP, sem WebRTC): cai no contexto `from-trunk`,
 * ou seja, o que ele disca (ex.: 0800123456) entra na URA como se viesse da operadora. Só para bancada/PoC.
 */
function renderTestCaller(ext, secret) {
  return `; ramal de TESTE ${ext} (simula o tronco — NÃO use em produção)
[${ext}]
type=endpoint
transport=transport-udp
context=from-trunk
disallow=all
allow=ulaw,alaw
auth=${ext}
aors=${ext}
callerid="Teste ${ext}" <${ext}>
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733

[${ext}]
type=auth
auth_type=userpass
username=${ext}
password=${derivePassword(secret, ext)}

[${ext}]
type=aor
max_contacts=1
remove_existing=yes
qualify_frequency=30
`;
}

function generate(env = process.env) {
  const secret = env.BV_SIP_SECRET;
  if (!secret) throw new Error('BV_SIP_SECRET não definido');
  const start = Number(env.BV_AGENT_EXT_START || 1001);
  const end = Number(env.BV_AGENT_EXT_END || 1050);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end - start > 2000) throw new Error('Faixa de ramais inválida (BV_AGENT_EXT_START..END, máx. 2001 ramais)');
  const codecs = env.BV_AGENT_CODECS || 'opus,ulaw,alaw';
  const transport = env.BV_AGENT_TRANSPORT || 'transport-wss';
  let out = `; GERADO por gen-agents.js — não edite. Ramais ${start}-${end}.\n\n`;
  for (let e = start; e <= end; e++) out += renderAgent(e, secret, codecs, transport) + '\n';
  const test = env.BV_TEST_CALLER_EXT;
  if (test) {
    if (!/^[0-9]{3,10}$/.test(test)) throw new Error('BV_TEST_CALLER_EXT deve ter 3 a 10 dígitos');
    if (Number(test) >= start && Number(test) <= end) throw new Error('BV_TEST_CALLER_EXT não pode estar dentro da faixa dos atendentes');
    out += renderTestCaller(test, secret) + '\n';
  }
  return out;
}

module.exports = { derivePassword, generate, PASSWORD_LENGTH };

if (require.main === module) {
  try {
    const out = generate();
    if (process.argv[2]) fs.writeFileSync(process.argv[2], out, { mode: 0o640 });
    else process.stdout.write(out);
  } catch (err) {
    console.error(`gen-agents: ${err.message}`);
    process.exit(1);
  }
}
