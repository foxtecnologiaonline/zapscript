'use client';

const TOKEN_KEY = 'zb_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });

  // Sessão expirada/token inválido numa rota autenticada — sem isso, uma
  // página do dashboard aberta sem login (ou com token vencido) ficava
  // presa em "Carregando..." pra sempre, com a rejeição só no console.
  // Não se aplica a /api/auth/* (ali um 401 é "senha errada", não sessão
  // expirada — a própria tela de login já trata isso inline).
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data?.error || `Erro ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
