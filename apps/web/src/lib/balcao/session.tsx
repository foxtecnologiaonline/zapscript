'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { bv, BvApiError, clearSession, getAccessToken, onTokenChange, storeSession, type SessionTokens } from './api';

export interface BvUserMe {
  id: string; orgId: string; name: string; email: string; role: 'ATENDENTE' | 'SUPERVISOR' | 'ADMIN' | 'FISCAL';
  orgName?: string; orgSlug?: string; sectorId?: string | null; skills?: string[]; sipExtension?: string | null; presence?: string;
}
export interface MeResponse { user: BvUserMe; permissions: string[]; mustChangePassword: boolean; totpEnabled: boolean; mfaSetupRequired: boolean; recoveryCodesRemaining?: number }

export type LoginResult =
  | { kind: 'ok'; me: MeResponse }
  | { kind: 'mfa'; mfaToken: string }
  | { kind: 'org'; orgs: Array<{ slug: string; name: string }> };

interface Ctx {
  status: 'loading' | 'anon' | 'authed';
  me: MeResponse | null;
  token: string | null;
  can: (perm: string) => boolean;
  canAny: (perms: string[]) => boolean;
  login: (email: string, password: string, orgSlug?: string) => Promise<LoginResult>;
  loginMfa: (mfaToken: string, code: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);
export const useBvSession = () => { const c = useContext(SessionCtx); if (!c) throw new Error('useBvSession fora do provider'); return c; };

export function BvSessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Ctx['status']>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!getAccessToken()) { setMe(null); setStatus('anon'); return; }
    try { const r = await bv.get<MeResponse>('/auth/me'); setMe(r); setToken(getAccessToken()); setStatus('authed'); }
    catch (e) { if (e instanceof BvApiError && e.status === 401) { clearSession(); } setMe(null); setStatus('anon'); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => onTokenChange((t) => { setToken(t); if (!t) { setMe(null); setStatus('anon'); } }), []);

  const finish = useCallback(async (s: SessionTokens): Promise<LoginResult> => {
    storeSession(s);
    const r = await bv.get<MeResponse>('/auth/me');
    setMe(r); setToken(getAccessToken()); setStatus('authed');
    return { kind: 'ok', me: r };
  }, []);

  const login = useCallback(async (email: string, password: string, orgSlug?: string): Promise<LoginResult> => {
    try {
      const r = await bv.anon.post<any>('/auth/login', { email, password, ...(orgSlug ? { orgSlug } : {}) });
      if (r.mfaRequired) return { kind: 'mfa', mfaToken: r.mfaToken };
      return await finish(r);
    } catch (e) {
      if (e instanceof BvApiError && e.code === 'auth.org_required') return { kind: 'org', orgs: ((e.details as any)?.orgs ?? []) };
      throw e;
    }
  }, [finish]);

  const loginMfa = useCallback(async (mfaToken: string, code: string) => finish(await bv.anon.post<any>('/auth/login/mfa', { mfaToken, code })), [finish]);

  const logout = useCallback(async () => {
    try { await bv.post('/auth/logout', { refreshToken: localStorage.getItem('bv_refresh') ?? undefined }); } catch { /* sessão já inválida */ }
    clearSession(); setMe(null); setStatus('anon');
  }, []);

  const value = useMemo<Ctx>(() => {
    const perms = new Set(me?.permissions ?? []);
    return { status, me, token, can: (p) => perms.has(p), canAny: (ps) => ps.some((p) => perms.has(p)), login, loginMfa, logout, reload };
  }, [status, me, token, login, loginMfa, logout, reload]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
