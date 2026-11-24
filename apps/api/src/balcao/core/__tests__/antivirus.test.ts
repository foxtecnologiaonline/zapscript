process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import net from 'net';
import Fastify from 'fastify';
import { prisma } from '../../../lib/prisma';
import { scanBuffer, enforceScan, AttachmentRejectedError } from '../antivirus';
import { putObject, newKey, statObject } from '../storage';
import { authHeader, makeOrg, makeUser } from '../testing';
import { bvAuth, clearAuthCache } from '../http';

/** clamd falso: lê o INSTREAM e responde FOUND se o conteúdo contiver "EICAR". */
function fakeClamd(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) {
          sock.write(buf.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          sock.end();
        }
      });
    }).listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as net.AddressInfo).port, close: () => srv.close() }));
  });
}

describe('antivírus (ClamAV via INSTREAM)', () => {
  afterEach(() => { delete process.env.BV_CLAMAV_HOST; delete process.env.BV_CLAMAV_PORT; delete process.env.BV_CLAMAV_FAIL_MODE; });

  it('desligado por padrão (skipped)', async () => {
    expect((await scanBuffer(Buffer.from('x'))).status).toBe('skipped');
  });
  it('limpo, infectado e remoção do arquivo recusado', async () => {
    const c = await fakeClamd();
    process.env.BV_CLAMAV_HOST = '127.0.0.1'; process.env.BV_CLAMAV_PORT = String(c.port);
    expect((await scanBuffer(Buffer.from('documento normal'))).status).toBe('clean');
    const bad = await scanBuffer(Buffer.from('X5O!EICAR-TEST'));
    expect(bad).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
    const key = newKey('org-av', 'attachments', 'txt');
    await expect(putObject(key, Buffer.from('EICAR payload'), { scan: true })).rejects.toBeInstanceOf(AttachmentRejectedError);
    expect(await statObject(key)).toBeNull();
    const ok = newKey('org-av', 'attachments', 'txt');
    await putObject(ok, Buffer.from('ok'), { scan: true });
    expect(await statObject(ok)).not.toBeNull();
    c.close();
  });
  it('clamd fora do ar: fail-closed recusa; fail-open aceita', async () => {
    process.env.BV_CLAMAV_HOST = '127.0.0.1'; process.env.BV_CLAMAV_PORT = '1';
    const r = await scanBuffer(Buffer.from('a'));
    expect(r.status).toBe('error');
    expect(() => enforceScan(r)).toThrow(AttachmentRejectedError);
    process.env.BV_CLAMAV_FAIL_MODE = 'open';
    expect(() => enforceScan(r)).not.toThrow();
  });
});

describe('bvAuth — senha temporária e MFA obrigatório são aplicados no backend', () => {
  it('bloqueia rotas fora de /auth/* até trocar a senha; MFA exigido por perfil', async () => {
    const org = await makeOrg({ security: { requireMfaRoles: ['SUPERVISOR'] } });
    const temp = await makeUser(org.id, 'ATENDENTE');
    await prisma.bvUser.update({ where: { id: temp.id }, data: { mustChangePassword: true } });
    const sup = await makeUser(org.id, 'SUPERVISOR');
    const ok = await makeUser(org.id, 'ATENDENTE');
    clearAuthCache();
    const app = Fastify();
    app.get('/balcao/conversations', { preHandler: bvAuth }, async () => ({ ok: 1 }));
    app.get('/balcao/auth/me', { preHandler: bvAuth }, async () => ({ me: 1 }));
    const r1 = await app.inject({ url: '/balcao/conversations', headers: authHeader(temp) });
    expect(r1.statusCode).toBe(403); expect(r1.json().error.code).toBe('auth.password_change_required');
    expect((await app.inject({ url: '/balcao/auth/me', headers: authHeader(temp) })).statusCode).toBe(200);
    const r2 = await app.inject({ url: '/balcao/conversations', headers: authHeader(sup) });
    expect(r2.statusCode).toBe(403); expect(r2.json().error.code).toBe('auth.mfa_setup_required');
    expect((await app.inject({ url: '/balcao/conversations', headers: authHeader(ok) })).statusCode).toBe(200);
    await app.close();
  });
});
