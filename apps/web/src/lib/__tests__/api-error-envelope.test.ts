/**
 * Leitura do envelope de erro no cliente web (item 6 do escopo ZapScript × Twilio).
 *
 * A API passou a ter DOIS formatos de erro: o antigo das rotas do painel
 * (`{ error: "frase" }`) e o novo da plataforma/API pública
 * (`{ error: { code, message, ... } }`). Sem tratar os dois, o formato novo
 * apareceria na tela como "[object Object]".
 */

// Nomes próprios (sufixo `Env`): api-refresh.test.ts não tem import nem export,
// então o tsc o trata como script no escopo GLOBAL — consts de topo com o mesmo
// nome nos dois arquivos colidem no typecheck (o Jest rodaria de qualquer forma).
const storeEnv: Record<string, string> = {};
const lsStubEnv = {
  getItem:    (k: string) => storeEnv[k] ?? null,
  setItem:    (k: string, v: string) => { storeEnv[k] = v; },
  removeItem: (k: string) => { delete storeEnv[k]; },
};
beforeAll(() => {
  (global as any).window = { location: { pathname: '/dashboard', href: '' } };
  (global as any).localStorage = lsStubEnv;
  (global as any).window.localStorage = lsStubEnv;
});

let apiEnv: any;
beforeEach(async () => {
  for (const k of Object.keys(storeEnv)) delete storeEnv[k];
  storeEnv['zs_token'] = 'access-1';
  jest.resetModules();
  apiEnv = (await import('../api')).api;
});

const resJsonEnv = (body: any, status = 200) =>
  ({ ok: status < 400, status, statusText: 'Bad Request', json: async () => body }) as any;

test('formato NOVO: usa error.message e expõe o code estável', async () => {
  global.fetch = jest.fn().mockResolvedValue(resJsonEnv({
    error: {
      code: 'template.header_media_required',
      message: 'O template "promo_img" tem header de image — informe template.header.',
      docUrl: 'https://zapscript.me/docs/erros/template.header_media_required',
      retryable: false,
      requestId: 'req-1',
    },
  }, 400));

  const err: any = await apiEnv.post('/messages', {}).catch((e: any) => e);

  // Sem o tratamento, a mensagem seria "[object Object]".
  expect(err.message).toBe('O template "promo_img" tem header de image — informe template.header.');
  expect(err.code).toBe('template.header_media_required');
  expect(err.status).toBe(400);
  expect(err.retryable).toBe(false);
  expect(err.requestId).toBe('req-1');
});

test('formato ANTIGO (rotas do painel) continua funcionando', async () => {
  global.fetch = jest.fn().mockResolvedValue(resJsonEnv({ error: 'Nome é obrigatório.' }, 400));

  const err: any = await apiEnv.post('/teams', {}).catch((e: any) => e);
  expect(err.message).toBe('Nome é obrigatório.');
  expect(err.code).toBeUndefined();
  expect(err.status).toBe(400);
});

test('corpo sem campo error cai no statusText, nunca em "undefined"', async () => {
  global.fetch = jest.fn().mockResolvedValue(resJsonEnv({ algo: 'inesperado' }, 400));
  const err: any = await apiEnv.get('/messages').catch((e: any) => e);
  expect(err.message).toBe('Bad Request');
});

test('resposta que não é JSON não quebra o tratamento de erro', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false, status: 502, statusText: 'Bad Gateway',
    json: async () => { throw new Error('não é JSON'); },
  } as any);

  const err: any = await apiEnv.get('/messages').catch((e: any) => e);
  expect(err.message).toBe('Bad Gateway');
  expect(err.status).toBe(502);
});

test('401 no formato novo também sai legível (sem refresh disponível)', async () => {
  delete storeEnv['zs_refresh'];
  global.fetch = jest.fn().mockResolvedValue(resJsonEnv({
    error: { code: 'auth.key_invalid', message: 'Chave inválida ou revogada.', docUrl: 'x', retryable: false },
  }, 401));

  const err: any = await apiEnv.get('/messages').catch((e: any) => e);
  expect(err.message).toBe('Chave inválida ou revogada.');
  expect(err.code).toBe('auth.key_invalid');
});
