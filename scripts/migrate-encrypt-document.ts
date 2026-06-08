/**
 * migrate-encrypt-document.ts
 * ────────────────────────────────────────────────────────────
 * Migra registros existentes: CPF/CNPJ em plaintext → AES-256-GCM
 * e preenche o campo documentHash (HMAC-SHA256 blind index).
 *
 * Compatibilidade retroativa: se o valor já estiver no formato
 * iv:tag:ciphertext, pula o registro (já foi migrado).
 *
 * Uso:
 *   ENCRYPTION_KEY=<64hex> DATABASE_URL=<url> npx ts-node scripts/migrate-encrypt-document.ts
 *   ou dentro do container:
 *   docker exec -it zapscript-api npx ts-node /app/scripts/migrate-encrypt-document.ts
 * ────────────────────────────────────────────────────────────
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Validar ENCRYPTION_KEY ────────────────────────────────
const rawKey = process.env.ENCRYPTION_KEY;
if (!rawKey || rawKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(rawKey)) {
  console.error('❌ ENCRYPTION_KEY inválida. Deve ser exatamente 64 hex chars.');
  process.exit(1);
}
const KEY = Buffer.from(rawKey, 'hex');

// ── AES-256-GCM encrypt ──────────────────────────────────
function encryptStr(plain: string): string {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

// ── HMAC-SHA256 blind index ──────────────────────────────
function computeHash(cpf: string): string {
  return crypto.createHmac('sha256', KEY).update(cpf).digest('hex');
}

// ── Detectar se já está criptografado (formato iv:tag:data) ─
function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p));
}

async function main() {
  console.log('🔐 Iniciando migração de CPF/CNPJ plaintext → AES-256-GCM ...\n');

  // Buscar todos os usuários com document não-nulo
  const users = await prisma.user.findMany({
    where:  { document: { not: null } },
    select: { id: true, document: true, documentHash: true },
  });

  console.log(`📋 Usuários com CPF/CNPJ cadastrado: ${users.length}`);

  let migrated  = 0;
  let skipped   = 0;
  let errors    = 0;

  for (const user of users) {
    const doc = user.document!;

    // Já migrado?
    if (isEncrypted(doc)) {
      // Garantir que documentHash existe (pode estar null se migração foi parcial)
      if (!user.documentHash) {
        try {
          // Precisamos decriptar para calcular o hash correto
          const [ivHex, tagHex, dataHex] = doc.split(':');
          const iv  = Buffer.from(ivHex,  'hex');
          const tag = Buffer.from(tagHex, 'hex');
          const enc = Buffer.from(dataHex, 'hex');
          const dec = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
          dec.setAuthTag(tag);
          const plain = Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
          const hash  = computeHash(plain);
          await prisma.user.update({ where: { id: user.id }, data: { documentHash: hash } });
          console.log(`  ✅ Hash adicionado (já criptografado): ${user.id}`);
          migrated++;
        } catch (e: any) {
          console.error(`  ❌ Erro ao adicionar hash para ${user.id}: ${e.message}`);
          errors++;
        }
      } else {
        console.log(`  ⏭️  Já migrado: ${user.id}`);
        skipped++;
      }
      continue;
    }

    // Plaintext → criptografar
    try {
      const clean     = doc.replace(/\D/g, ''); // normalizar (remover formatação)
      const encrypted = encryptStr(clean);
      const hash      = computeHash(clean);

      await prisma.user.update({
        where: { id: user.id },
        data:  { document: encrypted, documentHash: hash },
      });

      console.log(`  🔒 Migrado: ${user.id} (CPF: ${clean.slice(0,3)}***${clean.slice(-2)})`);
      migrated++;
    } catch (e: any) {
      console.error(`  ❌ Erro ao migrar ${user.id}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n📊 Resultado:`);
  console.log(`   ✅ Migrados:  ${migrated}`);
  console.log(`   ⏭️  Pulados:   ${skipped}`);
  console.log(`   ❌ Erros:     ${errors}`);

  if (errors > 0) {
    console.error('\n⚠️  Alguns registros falharam. Verifique os logs acima.');
    process.exit(1);
  }

  console.log('\n✨ Migração concluída com sucesso!');
}

main()
  .catch((e) => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
