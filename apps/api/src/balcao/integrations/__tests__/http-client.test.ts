import { createHttpClient, isBlockedIp, policyFromConfig, validatePublicUrl, IntegrationError } from '../http-client';
import { listen } from './fakes';

describe('integrations/http-client — SSRF e limites', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254'])('bloqueia %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '200.17.0.1', '2606:4700:4700::1111'])('permite público %s', (ip) => expect(isBlockedIp(ip)).toBe(false));

  it('validatePublicUrl rejeita hosts internos e credenciais na URL', () => {
    const p = { allowPrivateHosts: false };
    expect(validatePublicUrl('https://eproc.tjto.jus.br/mni', p)).toBeNull();
    expect(validatePublicUrl('http://169.254.169.254/latest', p)).toBeTruthy();
    expect(validatePublicUrl('http://localhost:8080', p)).toBeTruthy();
    expect(validatePublicUrl('http://metadata.google.internal/x', p)).toBeTruthy();
    expect(validatePublicUrl('ftp://x.com', p)).toBeTruthy();
    expect(validatePublicUrl('https://u:p@x.com', p)).toBeTruthy();
    expect(validatePublicUrl('http://127.0.0.1:9', { allowPrivateHosts: true })).toBeNull();
  });

  it('allowPrivateHosts é ignorado em produção', () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try { expect(policyFromConfig({ allowPrivateHosts: true }).allowPrivateHosts).toBe(false); } finally { process.env.NODE_ENV = old; }
    expect(policyFromConfig({ allowPrivateHosts: true }).allowPrivateHosts).toBe(true);
    expect(policyFromConfig({}).allowPrivateHosts).toBe(false);
  });

  it('cliente padrão bloqueia loopback/metadata mesmo com servidor ouvindo', async () => {
    const srv = await listen(() => [200, 'ok']);
    try {
      const c = createHttpClient(policyFromConfig({}));
      await expect(c.request({ url: `${srv.url}/x` })).rejects.toMatchObject({ code: 'http.ssrf_blocked' });
      await expect(c.request({ url: 'http://localhost:1/x' })).rejects.toMatchObject({ code: 'http.ssrf_blocked' });
      await expect(c.request({ url: 'http://169.254.169.254/latest/meta-data' })).rejects.toMatchObject({ code: 'http.ssrf_blocked' });
      expect(srv.hits).toHaveLength(0);
    } finally { await srv.close(); }
  });

  it('com política permissiva: funciona, estoura timeout e tamanho máximo, não segue redirect', async () => {
    const srv = await listen(async (r) => {
      if (r.path === '/slow') { await new Promise((x) => setTimeout(x, 400)); return [200, 'tarde']; }
      if (r.path === '/big') return [200, 'x'.repeat(5000)];
      if (r.path === '/redir') return [302, '', { location: 'http://169.254.169.254/' }];
      return [200, 'ok'];
    });
    try {
      const c = createHttpClient({ allowPrivateHosts: true, timeoutMs: 150, maxResponseBytes: 1024 });
      expect((await c.request({ url: `${srv.url}/ok` })).text).toBe('ok');
      await expect(c.request({ url: `${srv.url}/slow` })).rejects.toMatchObject({ code: 'http.timeout' });
      await expect(c.request({ url: `${srv.url}/big` })).rejects.toBeInstanceOf(IntegrationError);
      await expect(c.request({ url: `${srv.url}/big` })).rejects.toMatchObject({ code: 'http.too_large' });
      expect((await c.request({ url: `${srv.url}/redir` })).status).toBe(302);
    } finally { await srv.close(); }
  });
});
