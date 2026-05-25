const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('zs_token');
}

// ── Auto-redirect ao expirar JWT ────────────────────────────────────────────
// Quando o servidor retornar 401 (token expirado ou inválido), limpa o token
// local e redireciona o usuário para /login com um parâmetro de mensagem.
function handleUnauthorized() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('zs_token');
  // Não redirecionar em rotas públicas (login, cadastro, etc.)
  const publicPaths = ['/login', '/cadastro', '/esqueci-senha', '/redefinir-senha', '/convite', '/email-confirmado'];
  const isPublic = publicPaths.some(p => window.location.pathname.startsWith(p));
  if (!isPublic && window.location.pathname !== '/') {
    window.location.href = '/login?sessao=expirada';
  }
}

async function request<T>(path: string, opts: RequestInit = {}, isFormData = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> | undefined),
  };
  // Only set Content-Type for non-FormData requests
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers,
  });

  // Sessão expirada → redirecionar para login automaticamente
  if (res.status === 401) {
    handleUnauthorized();
    const body = await res.json().catch(() => ({ error: 'Sessão expirada. Faça login novamente.' }));
    const err  = new Error(body.error || 'Sessão expirada. Faça login novamente.') as any;
    Object.assign(err, body);
    throw err;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err  = new Error(body.error || 'Request failed') as any;
    Object.assign(err, body);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get:           <T>(path: string)                  => request<T>(path),
  post:          <T>(path: string, body: any)       => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  postFormData:  <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST',   body: formData }, true),
  put:           <T>(path: string, body: any)       => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:         <T>(path: string, body: any)       => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete:        <T>(path: string)                  => request<T>(path, { method: 'DELETE' }),

  setToken:      (token: string) => localStorage.setItem('zs_token', token),
  clearToken:    ()             => localStorage.removeItem('zs_token'),
};
