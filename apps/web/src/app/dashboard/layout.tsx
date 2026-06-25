'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// Item "Afiliados" é condicional: só entra para quem tem a marcação de afiliado
// aprovado (user.affiliate.status === 'approved'). Ver buildNav().
const NAV_BASE = [
  { href: '/dashboard',               icon: '🏠', label: 'Dashboard' },
  { href: '/dashboard/transcricoes',  icon: '📝', label: 'Conversões' },
  { href: '/dashboard/numeros',       icon: '📱', label: 'Números' },
  { href: '/dashboard/plano',         icon: '💳', label: 'Plano' },
  { href: '/dashboard/configuracoes', icon: '⚙️', label: 'Configurações' },
];

/** Monta o menu inserindo "Afiliados" antes de "Configurações" apenas para afiliados aprovados. */
function buildNav(user: any) {
  if (user?.affiliate?.status !== 'approved') return NAV_BASE;
  const nav = [...NAV_BASE];
  const idx = nav.findIndex(i => i.href === '/dashboard/configuracoes');
  const afiliadoItem = { href: '/dashboard/afiliado', icon: '🤝', label: 'Afiliados' };
  nav.splice(idx < 0 ? nav.length : idx, 0, afiliadoItem);
  return nav;
}

const PLAN_COLORS: Record<string, string> = {
  free:      'text-[rgba(16,185,129,.4)]',
  pro:       'text-[#10b981]',
  ultra:     'text-yellow-400',
  executive: 'text-amber-400',
};

/* ── Sidebar content — shared between desktop & mobile drawer ── */
function NavContent({
  user, pathname, onLogout, onClose,
}: {
  user: any;
  pathname: string;
  onLogout: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      {/* Logo header */}
      <div className="flex items-center gap-2 px-5 py-4 border-b dashboard-border">
        <Image src="/logo.png" alt="ZapScript" width={126} height={28} className="flex-1 object-contain object-left" style={{ minWidth: 0 }} />
        {/* Close button — only shown inside mobile drawer */}
        {onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-text transition-colors md:hidden"
            aria-label="Fechar menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {buildNav(user).map(item => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-brand-primary/10 dashboard-primary border dashboard-border'
                  : 'dashboard-text hover:bg-brand-primary/7 hover:text-brand-text'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="p-3 border-t dashboard-border">
        {user && (
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full dashboard-avatar flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{user.name || user.email}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[10px] capitalize font-semibold ${PLAN_COLORS[user.subscription?.plan?.name || 'free']}`}>
                  {user.subscription?.plan?.label || 'Grátis'}
                </span>
                {user.isTester && (
                  <span
                    className="inline-flex items-center text-[9px] font-black uppercase tracking-widest bg-[#10b981]/10 border border-[#10b981]/25 rounded-full px-2 py-0.5 text-[#10b981]"
                    title="Tester Oficial ZapScript"
                  >
                    Tester
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-brand-muted hover:text-red-400 hover:bg-red-400/5 transition-colors"
        >
          ↩ Sair da conta
        </button>
        <div className="px-3 pt-1 pb-0.5">
          <span className="text-[10px] text-brand-muted/40 font-mono">ZapScript v2.0</span>
        </div>
      </div>
    </>
  );
}

// ── Modal de aceite de termos para usuários já cadastrados ───────────────────
function TermsModal({ onAccepted }: { onAccepted: () => void }) {
  const [cbTos,      setCbTos]      = useState(false);
  const [cbContrato, setCbContrato] = useState(false);
  const [cbLgpd,     setCbLgpd]     = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  async function handleAccept() {
    if (!cbTos || !cbContrato || !cbLgpd) {
      setError('Aceite todos os termos obrigatórios para continuar.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/accept-terms', { cbTos, cbContrato, cbLgpd });
      onAccepted();
    } catch (e: any) {
      setError(e.message || 'Erro ao registrar aceite. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,11,9,0.92)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-md rounded-2xl p-6 sm:p-8 shadow-2xl"
        style={{ background: '#0d1c19', border: '1px solid rgba(16,185,129,.18)' }}>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl"
            style={{ background: 'rgba(16,185,129,.12)' }}>
            📋
          </div>
          <h2 className="text-lg font-bold text-brand-primary mb-1">Termos Atualizados</h2>
          <p className="text-xs text-brand-muted leading-relaxed">
            Atualizamos nossos documentos legais (v2.0). Leia e aceite para continuar usando o ZapScript.
          </p>
        </div>

        {/* Checkboxes */}
        <div className="space-y-1 mb-5 rounded-xl p-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-[10px] text-brand-muted uppercase tracking-widest font-mono mb-2">
            Consentimentos legais
          </p>

          <label className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
            <input type="checkbox" checked={cbTos} onChange={e => setCbTos(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-brand-primary flex-shrink-0" />
            <span className="text-[12px] text-brand-text-secondary leading-relaxed">
              Li e concordo com os{' '}
              <a href="/termos" target="_blank" className="text-brand-primary hover:underline font-medium">Termos de Serviço</a>
              {' '}<span className="font-mono text-[10px] text-brand-primary bg-brand-primary/10 px-1 rounded">obrigatório</span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
            <input type="checkbox" checked={cbContrato} onChange={e => setCbContrato(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-brand-primary flex-shrink-0" />
            <span className="text-[12px] text-brand-text-secondary leading-relaxed">
              Li e aceito o{' '}
              <a href="/contrato" target="_blank" className="text-brand-primary hover:underline font-medium">Contrato de Prestação de Serviços</a>
              , incluindo SLA e condições de rescisão.{' '}
              <span className="font-mono text-[10px] text-brand-primary bg-brand-primary/10 px-1 rounded">obrigatório</span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
            <input type="checkbox" checked={cbLgpd} onChange={e => setCbLgpd(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-brand-primary flex-shrink-0" />
            <span className="text-[12px] text-brand-text-secondary leading-relaxed">
              Autorizo o tratamento dos meus dados conforme a{' '}
              <a href="/privacidade" target="_blank" className="text-brand-primary hover:underline font-medium">Política de Privacidade</a>
              {' '}e a LGPD.{' '}
              <span className="font-mono text-[10px] text-brand-primary bg-brand-primary/10 px-1 rounded">obrigatório</span>
            </span>
          </label>

          <p className="text-[10px] text-brand-muted/50 font-mono leading-relaxed pt-1 px-1">
            Aceite registrado com timestamp como prova de consentimento (Art. 8º §2º LGPD).
          </p>
        </div>

        {error && (
          <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <button
          onClick={handleAccept}
          disabled={loading}
          className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50">
          {loading ? 'Registrando aceite...' : 'Aceitar e continuar →'}
        </button>

        <p className="text-center text-[10px] text-brand-muted mt-3 leading-relaxed">
          Ao aceitar, você confirma que leu e concordou com todos os documentos acima.
          Sem aceite, o acesso à plataforma não é possível.
        </p>
      </div>
    </div>
  );
}

// ── Banner suave de verificação de e-mail (não-bloqueante) ───────────────────
// Aparece quando o usuário ainda não confirmou o e-mail. A conta funciona
// normalmente (Opção A); a verificação só é exigida na hora de assinar um plano.
function EmailVerifyBanner({ email }: { email: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending]     = useState(false);
  const [sent, setSent]           = useState(false);

  if (dismissed) return null;

  async function resend() {
    setSending(true);
    try {
      await api.post('/auth/resend-verification', {});
      setSent(true);
    } catch {
      /* silencioso — banner é informativo */
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 pt-3">
      <div className="rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap"
        style={{ background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.25)' }}>
        <span className="text-base flex-shrink-0">📧</span>
        <p className="text-xs flex-1 min-w-[180px]" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          {sent ? (
            <>Link reenviado para <strong>{email}</strong>. Confira sua caixa de entrada (e o spam).</>
          ) : (
            <>Confirme seu e-mail para liberar a assinatura de planos. Sua conta já está ativa.</>
          )}
        </p>
        {!sent && (
          <button onClick={resend} disabled={sending}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
            style={{ background: 'rgba(251,191,36,.15)', color: '#fbbf24' }}>
            {sending ? 'Enviando...' : 'Reenviar link'}
          </button>
        )}
        <button onClick={() => setDismissed(true)}
          className="text-xs flex-shrink-0 transition-colors hover:opacity-70"
          style={{ color: 'rgb(var(--color-text-muted))' }}
          aria-label="Dispensar">
          ✕
        </button>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname   = usePathname();
  const router     = useRouter();
  const [user, setUser]               = useState<any>(null);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  useEffect(() => {
    api.get<any>('/auth/me')
      .then(u => {
        setUser(u);
        // Mostrar modal se usuário ainda não aceitou os termos v2.0
        if (!u?.termsAcceptedAt) setShowTermsModal(true);
      })
      .catch(() => router.push('/login'));
  }, []);

  // ── Keepalive: ping /health a cada 4 min para evitar cold start do Render ──
  // O Render free tier dorme após 15 min de inatividade → primeiro request leva 30-60s.
  // Usuários autenticados no dashboard mantêm o servidor acordado.
  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const ping = () => fetch(`${API_URL}/health`, { method: 'GET', cache: 'no-store' }).catch(() => null);
    ping(); // ping imediato ao entrar no dashboard
    const id = setInterval(ping, 4 * 60 * 1000); // a cada 4 min
    return () => clearInterval(id);
  }, []);

  // Close drawer automatically on navigation
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  function logout() { api.clearToken(); router.push('/login'); }

  return (
    <div className="flex min-h-screen dashboard-bg">
      {/* Modal bloqueante de aceite de termos para usuários existentes */}
      {showTermsModal && (
        <TermsModal onAccepted={() => {
          setShowTermsModal(false);
          setUser((u: any) => ({ ...u, termsAcceptedAt: new Date().toISOString() }));
        }} />
      )}

      {/* ── Desktop sidebar (hidden on mobile) ─── */}
      <aside className="hidden md:flex w-56 flex-shrink-0 dashboard-sidebar border-r dashboard-border flex-col sticky top-0 h-screen">
        <NavContent user={user} pathname={pathname} onLogout={logout} />
      </aside>

      {/* ── Mobile: backdrop + slide-in drawer ─── */}
      {menuOpen && (
        <div className="md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={() => setMenuOpen(false)}
          />
          {/* Drawer */}
          <aside
            className="fixed inset-y-0 left-0 z-50 w-64 flex flex-col dashboard-sidebar border-r dashboard-border"
            style={{ animation: 'slideInLeft .22s cubic-bezier(.4,0,.2,1) both' }}
          >
            <NavContent
              user={user}
              pathname={pathname}
              onLogout={logout}
              onClose={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* ── Content column ──────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 border-b dashboard-border dashboard-sidebar">
          <button
            onClick={() => setMenuOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-brand-primary/10 transition-colors text-brand-text"
            aria-label="Abrir menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>

          <Image src="/logo.png" alt="ZapScript" width={120} height={26} className="flex-1 object-contain object-left" style={{ minWidth: 0 }} />

          {user && (
            <div className="w-8 h-8 rounded-full dashboard-avatar flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">
          {user && user.emailVerified === false && <EmailVerifyBanner email={user.email} />}
          {children}
        </main>
      </div>
    </div>
  );
}
