// Ambiente node com window/localStorage stubados de propósito: instalar
// jest-environment-jsdom só para isto seria peso desnecessário — api.ts toca
// em window apenas pelo typeof e por window.location.
const store: Record<string, string> = {};
const localStorageStub = {
  getItem:    (k: string) => store[k] ?? null,
  setItem:    (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};
beforeAll(() => {
  (global as any).window = { location: { pathname: '/dashboard', href: '' } };
  (global as any).localStorage = localStorageStub;
  (global as any).window.localStorage = localStorageStub;
});

let api: any;
beforeEach(async () => {
  for (const k of Object.keys(store)) delete store[k];
  store['zs_token']   = 'access-velho';
  store['zs_refresh'] = 'refresh-1';
  jest.resetModules();
  api = (await import('../api')).api;
});

const jsonRes = (body: any, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as any;

test('401 dispara renovação, guarda os tokens novos e repete a requisição', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(jsonRes({ error: 'expirado' }, 401))                    // 1ª chamada
    .mockResolvedValueOnce(jsonRes({ token: 'access-novo', refreshToken: 'refresh-2' })) // /auth/refresh
    .mockResolvedValueOnce(jsonRes({ ok: true }));                                 // repetição
  global.fetch = fetchMock;

  await expect(api.get('/dashboard')).resolves.toEqual({ ok: true });

  expect(store['zs_token']).toBe('access-novo');
  expect(store['zs_refresh']).toBe('refresh-2');   // rotacionado
  // a repetição usa o token NOVO
  expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer access-novo');
});

test('N requisições em paralelo com 401 renovam UMA vez só (single-flight)', async () => {
  // Sem isto, cada uma apresentaria o mesmo refresh já rotacionado e o
  // servidor derrubaria a família inteira por suspeita de roubo.
  let refreshCalls = 0;
  global.fetch = jest.fn(async (url: any) => {
    if (String(url).includes('/auth/refresh')) {
      refreshCalls++;
      await new Promise(r => setTimeout(r, 10));
      return jsonRes({ token: 'access-novo', refreshToken: 'refresh-2' });
    }
    return store['zs_token'] === 'access-novo' ? jsonRes({ ok: true }) : jsonRes({ error: 'expirado' }, 401);
  }) as any;

  const rs = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c'), api.get('/d'), api.get('/e')]);
  expect(rs).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }]);
  expect(refreshCalls).toBe(1);
});

test('renovação falhada limpa a sessão e não repete em loop', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(jsonRes({ error: 'expirado' }, 401))
    .mockResolvedValueOnce(jsonRes({ error: 'sessao' }, 401));   // refresh recusado
  global.fetch = fetchMock;

  await expect(api.get('/dashboard')).rejects.toThrow();
  expect(store['zs_token']).toBeUndefined();
  expect(store['zs_refresh']).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(2);                    // sem terceira tentativa
});

test('uma renovação que falha não trava as futuras (regressão do single-flight)', async () => {
  // O bug: com o finally DENTRO do IIFE, uma saída antes do primeiro await
  // deixava a promise resolvida presa na variável e toda renovação seguinte
  // devolvia o resultado antigo sem nem chamar o servidor.
  delete store['zs_refresh'];
  global.fetch = jest.fn().mockResolvedValue(jsonRes({ error: 'expirado' }, 401)) as any;
  await expect(api.get('/x')).rejects.toThrow();          // sem refresh guardado

  // agora existe refresh: a renovação PRECISA ser tentada de verdade
  store['zs_token'] = 'access-velho';
  store['zs_refresh'] = 'refresh-1';
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(jsonRes({ error: 'expirado' }, 401))
    .mockResolvedValueOnce(jsonRes({ token: 'access-novo', refreshToken: 'refresh-2' }))
    .mockResolvedValueOnce(jsonRes({ ok: true }));
  global.fetch = fetchMock;

  await expect(api.get('/y')).resolves.toEqual({ ok: true });
  expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/refresh');
});

test('logout revoga no servidor antes de limpar o local', async () => {
  const fetchMock = jest.fn().mockResolvedValue(jsonRes({ ok: true }));
  global.fetch = fetchMock;
  await api.logout();
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain('/auth/logout');
  expect(JSON.parse(init.body).refreshToken).toBe('refresh-1');
  expect(store['zs_token']).toBeUndefined();
  expect(store['zs_refresh']).toBeUndefined();
});
