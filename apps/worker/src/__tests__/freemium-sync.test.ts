import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * apps/worker/src/lib/freemium.ts é intencionalmente duplicado em
 * apps/api/src/lib/freemium.ts. Um pacote workspace compartilhado (tipo
 * packages/modules) foi avaliado e descartado: os Dockerfiles de api e
 * worker buildam cada imagem isolada com `npm ci` a partir do
 * package-lock.json do próprio app (não pnpm workspace) — apontar os dois
 * para um pacote comum exigiria mudar a estratégia de build de ambas as
 * imagens, risco desproporcional para este cleanup.
 *
 * Este teste é a rede de segurança equivalente: garante que a duplicação
 * não diverge silenciosamente. Se alguém editar um lado sem o outro, o CI
 * quebra aqui em vez de a cota ficar inconsistente entre API e Worker em
 * produção.
 */
test('lib/freemium.ts do worker e da api ficam idênticos', () => {
  const worker = readFileSync(join(__dirname, '../lib/freemium.ts'), 'utf8');
  const api    = readFileSync(join(__dirname, '../../../api/src/lib/freemium.ts'), 'utf8');
  expect(worker).toBe(api);
});
