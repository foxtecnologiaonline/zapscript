#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Generate all required secrets for ZapScript
 * Run: node scripts/generate-secrets.js
 */

function generateSecret(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

const secrets = {
  JWT_SECRET: generateSecret(24), // 48 characters
  ENCRYPTION_KEY: generateSecret(32), // 64 characters
  INTERNAL_TOKEN: generateSecret(16), // 32 characters
  MONITOR_TOKEN: generateSecret(16), // 32 characters
  ADMIN_TOKEN: generateSecret(16), // 32 characters
  ASAAS_WEBHOOK_TOKEN: generateSecret(16), // 32 characters
};

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║        🔐 ZapScript Secrets Generation                           ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

console.log('Generated secrets:\n');
Object.entries(secrets).forEach(([key, value]) => {
  console.log(`${key}=${value}`);
});

// Append to .env if it exists
const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

if (fs.existsSync(envPath)) {
  console.log('\n✓ .env file found. Updating...');
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Update each secret
  Object.entries(secrets).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
      console.log(`  ✓ Updated ${key}`);
    } else {
      envContent += `\n${key}=${value}`;
      console.log(`  ✓ Added ${key}`);
    }
  });

  fs.writeFileSync(envPath, envContent);
  console.log('\n✅ .env file updated successfully!');
} else if (fs.existsSync(envExamplePath)) {
  console.log('\n⚠️  .env not found. Copy from .env.example:');
  console.log(`  cp .env.example .env`);
  console.log(`  Then run this script again.`);
} else {
  console.log('\n⚠️  Neither .env nor .env.example found.');
  console.log('Create a .env file and add these secrets.');
}

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  ⚠️  IMPORTANT:                                                  ║');
console.log('║  - Never commit .env to git                                      ║');
console.log('║  - Keep these secrets secure                                     ║');
console.log('║  - Rotate tokens every 90 days in production                     ║');
console.log('║  - Use AWS Secrets Manager in production                         ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

process.exit(0);
