const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.zapscript.me';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('zs_token');
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('zs_refresh');
}

function storeTokens(token: string, refreshToken?: string) {
  localStorage.setItem('zs_token', token);
  if (refreshToken) localStorage.setItem('zs_refresh', refreshToken);
}

// ── Auto-redirect ao expirar a sessão ───────────────────────────────────────
// Só chega aqui depois que a renovação via refresh token falhou — aí sim a
// sessão acabou de verdade.
function handleUnauthorized() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('zs_token');
  localStorage.removeItem('zs_refresh');
  // Redirecionar somente dentro do dashboard (rotas protegidas por JWT de usuário)
  if (window.location.pathname.startsWith('/dashboard')) {
    window.location.href = '/login?sessao=expirada';
  }
}

// ── Renovação com single-flight ─────────────────────────────────────────────
// O access token agora dura 1h e o refresh ROTACIONA a cada uso: o token
// antigo é revogado na hora. Se o painel dispara 5 requisições juntas e todas
// pegam 401, cada uma tentando renovar com o MESMO refresh, só a primeira
// rotaciona — as outras quatro apresentariam um token já revogado, que o
// servidor trata como sinal de roubo e derruba a família inteira. O usuário
// seria deslogado justamente por usar o app normalmente.
//
// Por isso a renovação é compartilhada: a primeira chamada cria a promise e
// as demais aguardam o mesmo resultado.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const pendente = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        // O single-flight só vale DENTRO desta aba. Com duas abas abertas,
        // cada uma tem seu próprio contexto JS e as duas renovam ao mesmo
        // tempo com o mesmo refresh; o servidor deixa uma ganhar e recusa a
        // outra. Sem este trecho, a aba perdedora tratava a recusa como
        // "sessão acabou" e deslogava o usuário — a cada hora, só por ter
        // duas abas abertas.
        //
        // Se o refresh guardado mudou enquanto esperávamos, foi a outra aba
        // que rotacionou com sucesso: a sessão está viva e é só seguir com o
        // token novo.
        return getRefreshToken() !== refreshToken;
      }
      const data = await res.json();
      if (!data?.token) return false;
      storeTokens(data.token, data.refreshToken);
      return true;
    } catch {
      return false;   // rede fora: não desloga, o chamador decide
    }
  })();

  refreshInFlight = pendente;
  // A limpeza precisa ficar FORA do corpo acima: sem refresh token guardado o
  // IIFE retorna antes de qualquer await, então um `finally` interno rodaria
  // ANTES desta atribuição — a variável ficaria presa com uma promise já
  // resolvida e toda renovação seguinte devolveria o `false` antigo, sem nem
  // chamar o servidor. A guarda de identidade evita que uma renovação antiga
  // limpe a vez de uma mais nova.
  void pendente.finally(() => { if (refreshInFlight === pendente) refreshInFlight = null; });

  return pendente;
}

/**
 * Extrai a mensagem humana do corpo de erro da API, nos DOIS formatos em uso:
 *
 *  • antigo (rotas do painel):  { error: "frase em português" }
 *  • novo (plataforma/API pública, item 6 do escopo ZapScript × Twilio):
 *    { error: { code, message, docUrl, retryable, requestId } }
 *
 * Sem isto, `new Error(body.error)` no formato novo produziria a mensagem
 * "[object Object]" na tela. Além da frase, devolve o `code` estável para quem
 * quiser tratar um erro específico (ex.: distinguir "chave sem escopo" de
 * "chave revogada") sem comparar texto.
 */
function parseApiError(body: any, fallback: string): { message: string; code?: string; extra: Record<string, any> } {
  const raw = body?.error;
  if (raw && typeof raw === 'object') {
    return {
      message: typeof raw.message === 'string' && raw.message ? raw.message : fallback,
      code:    typeof raw.code === 'string' ? raw.code : undefined,
      extra:   { ...raw, error: undefined },
    };
  }
  return {
    message: typeof raw === 'string' && raw ? raw : fallback,
    extra:   { ...(body && typeof body === 'object' ? body : {}) },
  };
}

async function request<T>(path: string, opts: RequestInit = {}, isFormData = false, isRetry = false): Promise<T> {
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

  if (res.status === 401) {
    // Uma tentativa de renovar e repetir antes de desistir. `isRetry` impede
    // laço infinito se o 401 não for por token expirado (ex.: rota que exige
    // permissão que o usuário não tem).
    // /auth/refresh nunca passa por aqui — ele usa fetch direto.
    if (!isRetry && getRefreshToken()) {
      const renovou = await refreshSession();
      if (renovou) return request<T>(path, opts, isFormData, true);
    }

    handleUnauthorized();
    const body = await res.json().catch(() => ({ error: 'Sessão expirada. Faça login novamente.' }));
    const parsed = parseApiError(body, 'Sessão expirada. Faça login novamente.');
    const err = new Error(parsed.message) as any;
    Object.assign(err, parsed.extra, { code: parsed.code, status: res.status });
    throw err;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const parsed = parseApiError(body, res.statusText || 'Request failed');
    const err = new Error(parsed.message) as any;
    Object.assign(err, parsed.extra, { code: parsed.code, status: res.status });
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Busca um binário (áudio/vídeo) autenticado como Blob — <audio>/<video src>
 * não manda Authorization, então a prévia de mídia protegida por JWT precisa
 * passar por fetch manual + URL.createObjectURL no chamador.
 */
async function getBlob(path: string, isRetry = false): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  // Mesma renovação do request(): sem isto, a prévia de áudio quebrava sozinha
  // depois de 1h com a sessão ainda válida.
  if (res.status === 401 && !isRetry && getRefreshToken()) {
    if (await refreshSession()) return getBlob(path, true);
  }
  if (!res.ok) throw new Error('Não foi possível carregar a mídia.');
  return res.blob();
}

export const api = {
  get:           <T>(path: string)                  => request<T>(path),
  getBlob,
  post:          <T>(path: string, body: any)       => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  postFormData:  <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST',   body: formData }, true),
  put:           <T>(path: string, body: any)       => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  putFormData:   <T>(path: string, formData: FormData) => request<T>(path, { method: 'PUT',    body: formData }, true),
  patch:         <T>(path: string, body: any)       => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete:        <T>(path: string)                  => request<T>(path, { method: 'DELETE' }),

  setToken:      (token: string, refreshToken?: string) => storeTokens(token, refreshToken),
  clearToken:    ()             => { localStorage.removeItem('zs_token'); localStorage.removeItem('zs_refresh'); },

  /** Logout de verdade: revoga a sessão no servidor antes de limpar o local. */
  logout: async (allDevices = false) => {
    const refreshToken = getRefreshToken();
    const token        = getToken();
    try {
      await fetch(`${API}/auth/logout`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ refreshToken, allDevices }),
      });
    } catch {
      // Servidor fora não pode impedir o usuário de sair na própria máquina.
    }
    localStorage.removeItem('zs_token');
    localStorage.removeItem('zs_refresh');
  },
};
