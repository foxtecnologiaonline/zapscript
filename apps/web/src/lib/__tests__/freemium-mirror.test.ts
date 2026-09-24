import { readFileSync } from 'fs';
import { join } from 'path';
import { CORE_AUDIO_QUOTA } from '../promo';

/**
 * CORE_AUDIO_QUOTA (apps/web/src/lib/promo.ts) é um espelho hardcoded de
 * FREE_AUDIO_QUOTA (apps/api|worker/src/lib/freemium.ts) — o web não importa
 * do backend, porque o valor é usado em página estática de marketing (LP,
 * /precos, funil de cadastro).
 *
 * A divergência entre api e worker já é coberta por
 * apps/worker/src/__tests__/freemium-sync.test.ts (compara os dois arquivos).
 * O espelho do web ficava de fora: dava pra mudar a cota no backend e o site
 * seguir anunciando o número antigo — o usuário compra esperando X áudios e
 * o worker corta em Y. O commit fdab2b5 (200 → 300) mostra o risco na
 * prática: precisou de três edições manuais em arquivos separados.
 *
 * Este teste fecha essa ponta lendo o default declarado no backend.
 */
test('CORE_AUDIO_QUOTA do marketing bate com FREE_AUDIO_QUOTA do backend', () => {
  const freemiumSrc = readFileSync(
    join(__dirname, '../../../../api/src/lib/freemium.ts'),
    'utf8',
  );

  // export const FREE_AUDIO_QUOTA = parseInt(process.env.FREE_AUDIO_QUOTA || '300', 10);
  const match = freemiumSrc.match(
    /FREE_AUDIO_QUOTA\s*=\s*parseInt\(\s*process\.env\.FREE_AUDIO_QUOTA\s*\|\|\s*'(\d+)'/,
  );

  // Se a declaração mudar de forma, falha aqui em vez de passar vazia e
  // deixar o espelho desprotegido de novo.
  expect(match).not.toBeNull();

  expect(CORE_AUDIO_QUOTA).toBe(Number(match![1]));
});
