/** QR codes em memória, indexados por instanceName. TTL de 60s. */
interface Entry { qr: string; ts: number; }
const store = new Map<string, Entry>();
const TTL = 60_000;

export function storeQr(instanceName: string, qr: string) {
  store.set(instanceName, { qr, ts: Date.now() });
}

export function getQr(instanceName: string): string | null {
  const e = store.get(instanceName);
  if (!e) return null;
  if (Date.now() - e.ts > TTL) { store.delete(instanceName); return null; }
  return e.qr;
}

export function clearQr(instanceName: string) {
  store.delete(instanceName);
}
