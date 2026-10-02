/**
 * Ponte para as filas do worker sob o caminho `./queue` relativo a
 * `src/services/`.
 *
 * Por que existe: serviços compartilhados entre api e worker são COPIADOS byte
 * a byte (os Dockerfiles não compartilham packages/* — ver
 * apps/api/src/services/ai-fallback.ts). Para a cópia ser idêntica, o import
 * precisa resolver no mesmo caminho relativo nos dois lados. Na API as filas
 * vivem em `src/services/queue.ts`; no worker, em `src/lib/queue.ts`. Este
 * arquivo reexporta o que os serviços compartilhados usam, para que
 * `import { webhooksQueue } from './queue'` funcione nos dois.
 *
 * Não acrescente lógica aqui — é só reexport.
 */
export { redis, webhooksQueue, messagesOutQueue } from '../lib/queue';
