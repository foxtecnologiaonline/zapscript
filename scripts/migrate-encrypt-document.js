/**
 * migrate-encrypt-document.js  — Node.js puro, sem ts-node
 * Roda DENTRO do container zapscript-api com:
 *
 *   docker exec zapscript-api node /tmp/migrate-encrypt-document.js
 *
 * O script lê ENCRYPTION_KEY e DATABASE_URL do ambiente do container.
 * ─────────────────────────────────────────────────────────────────────
 */
'use strict';

const crypto = require('crypto');
const { PrismaClient } = require('./apps/api/node_modules/@prisma/client');

// ── Validar ENCRYPTION_KEY ────────────────────────────────────────────
const rawKey = process.env.ENCRYPTION_KEY;
if (!rawKey || rawKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(rawKey)) {
  console.error('❌  ENCRYPTION_KEY inválida — deve ter exatamente 64 hex chars.');
  process.exit(1);
}
const KEY = Buffer.from(rawKey, 'hex');

// ── Funções crypto ────────────────────────────────────────────────────
function encryptStr(plain) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

function decryptStr(enc) {
  const parts = enc.split(':');
  if (parts.length !== 3) return enc; // plaintext legado
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const iv  = Buffer.from(ivHex,  'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const dat = Buffer.from(dataHex, 'hex');
    const dec = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(dat), dec.final()]).toString('utf8');
  } catch { return null; }
}

function computeHash(cpf) {
  return crypto.createHmac('sha256', KEY).update(cpf).digest('hex');
}

function isEncrypted(val) {
  const parts = val.split(':');
  return parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p));
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const prisma = new PrismaClient();

  console.log('\n🔐  Migração CPF/CNPJ plaintext → AES-256-GCM\n');

  const users = await prisma.user.findMany({
    where:  { document: { not: null } },
    select: { id: true, document: true, documentHash: true },
  });

  console.log(`📋  Usuários com CPF/CNPJ: ${users.length}\n`);

  let migrated = 0, skipped = 0, errors = 0;

  for (const u of users) {
    const doc = u.document;

    if (isEncrypted(doc)) {
      if (!u.documentHash) {
        // Já criptografado mas sem hash — calcular e salvar
        const plain = decryptStr(doc);
        if (!plain) { console.error(`  ❌  Não conseguiu decriptar: ${u.id}`); errors++; continue; }
        const hash = computeHash(plain);
        try {
          await prisma.user.update({ where: { id: u.id }, data: { documentHash: hash } });
          console.log(`  ✅  Hash adicionado (já enc): ${u.id}`);
          migrated++;
        } catch (e) { console.error(`  ❌  ${u.id}: ${e.message}`); errors++; }
      } else {
        console.log(`  ⏭️   Já migrado: ${u.id}`);
        skipped++;
      }
      continue;
    }

    // Plaintext → criptografar
    try {
      const clean = doc.replace(/\D/g, '');
      const hash  = computeHash(clean);

      // Verificar conflito de hash antes de salvar
      const conflict = await prisma.user.findFirst({
        where: { documentHash: hash, NOT: { id: u.id } },
        select: { id: true },
      });
      if (conflict) {
        console.warn(`  ⚠️   CPF duplicado ignorado (conflict com ${conflict.id}): ${u.id}`);
        skipped++;
        continue;
      }

      await prisma.user.update({
        where: { id: u.id },
        data:  { document: encryptStr(clean), documentHash: hash },
      });
      const masked = clean.slice(0,3) + '***' + clean.slice(-2);
      console.log(`  🔒  Migrado: ${u.id}  (doc: ${masked})`);
      migrated++;
    } catch (e) {
      console.error(`  ❌  ${u.id}: ${e.message}`);
      errors++;
    }
  }

  await prisma.$disconnect();

  console.log(`\n📊  Resultado:`);
  console.log(`   ✅  Migrados :  ${migrated}`);
  console.log(`   ⏭️   Pulados  :  ${skipped}`);
  console.log(`   ❌  Erros    :  ${errors}`);

  if (errors > 0) { console.error('\n⚠️   Verifique os erros acima.'); process.exit(1); }
  console.log('\n✨  Concluído!\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
