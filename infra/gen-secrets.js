#!/usr/bin/env node
/**
 * ZapScript — Gerador de Segredos
 * Gera todos os tokens necessários de forma segura.
 */
const crypto = require('crypto');

const secrets = {
  JWT_SECRET:     crypto.randomBytes(48).toString('hex'),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  INTERNAL_TOKEN: crypto.randomBytes(32).toString('hex'),
  MONITOR_TOKEN:  crypto.randomBytes(32).toString('hex'),
  ADMIN_TOKEN:    crypto.randomBytes(32).toString('hex'),
};

console.log('\n🔐 ZapScript — Segredos Gerados\n');
console.log('Copie os valores abaixo para o seu .env:\n');
Object.entries(secrets).forEach(([k, v]) => console.log(`${k}=${v}`));
console.log('\n⚠️  Guarde em local seguro. Não compartilhe nem commite.\n');
