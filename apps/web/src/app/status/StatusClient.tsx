'use client';
import { useState } from 'react';

type Status = 'done' | 'in-progress' | 'pending';
type Category = 'auth' | 'api' | 'frontend' | 'security' | 'infrastructure' | 'monitoring';

interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  category: Category;
  owner: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  completedAt?: string;
}

const tasks: Task[] = [
  // ── AUTH & REGISTRATION ──────────────────────────────────────────────────
  {
    id: 'auth-register',
    title: 'Cadastro com verificação de e-mail',
    description: 'Fluxo completo: registro → envio de e-mail → confirmação → dashboard',
    status: 'done',
    category: 'auth',
    owner: 'Claude',
    priority: 'critical',
    completedAt: '2026-04-24',
  },
  {
    id: 'auth-email-verification',
    title: 'E-mail de verificação funcional',
    description: 'Supabase generateLink + nodemailer + template HTML',
    status: 'done',
    category: 'auth',
    owner: 'Claude',
    priority: 'critical',
    completedAt: '2026-04-24',
  },
  {
    id: 'auth-login-rate-limit',
    title: 'Rate limit no login (5 req/min)',
    description: 'Proteção contra brute-force via @fastify/rate-limit',
    status: 'done',
    category: 'auth',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-24',
  },
  {
    id: 'auth-forgot-password',
    title: 'Fluxo "Esqueci minha senha"',
    description: 'Endpoint + e-mail de recuperação + página de reset',
    status: 'done',
    category: 'auth',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-24',
  },
  {
    id: 'auth-duplicate-prevention',
    title: 'Prevenção de duplicidade (e-mail + CPF/CNPJ)',
    description: 'Validação em ambos os lados (frontend + Prisma @unique)',
    status: 'done',
    category: 'auth',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-03-15',
  },
  {
    id: 'auth-email-field-sync',
    title: 'Campo emailVerified sincronizado com Supabase',
    description: 'Atualiza para true no primeiro login pós-confirmação',
    status: 'done',
    category: 'auth',
    owner: 'Claude',
    priority: 'medium',
    completedAt: '2026-04-24',
  },

  // ── API SECURITY ─────────────────────────────────────────────────────────
  {
    id: 'sec-timing-attack',
    title: 'Proteção contra timing attacks',
    description: 'crypto.timingSafeEqual em admin/internal/monitor tokens',
    status: 'done',
    category: 'security',
    owner: 'Claude',
    priority: 'critical',
    completedAt: '2026-04-23',
  },
  {
    id: 'sec-encryption-validation',
    title: 'Validação de ENCRYPTION_KEY no startup',
    description: 'Deve ser 64 hex chars; decrypt valida formato iv:tag:data',
    status: 'done',
    category: 'security',
    owner: 'Claude',
    priority: 'critical',
    completedAt: '2026-04-23',
  },
  {
    id: 'sec-xss-escape',
    title: 'Escape HTML em inputs do usuário (support.ts)',
    description: 'Previne XSS antes de injtar em templates de e-mail',
    status: 'done',
    category: 'security',
    owner: 'Claude',
    priority: 'critical',
    completedAt: '2026-04-23',
  },
  {
    id: 'sec-cors-restriction',
    title: 'CORS restrito a APP_URL (sem * ou true)',
    description: 'Fallback para localhost:3000 em dev, false em prod',
    status: 'done',
    category: 'security',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'sec-idempotency',
    title: 'Idempotência de webhook Asaas (24h via Map)',
    description: 'In-memory deduplication; cleanup a cada 1000 entries',
    status: 'done',
    category: 'security',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'sec-input-clamping',
    title: 'Input clamping (limit/offset)',
    description: 'limit 1-100, offset ≥0 em transcriptions + admin',
    status: 'done',
    category: 'security',
    owner: 'Claude',
    priority: 'medium',
    completedAt: '2026-04-23',
  },

  // ── API FEATURES ────────────────────────────────────────────────────────
  {
    id: 'api-admin-stats',
    title: 'Dashboard admin com estatísticas completas',
    description: 'MRR, conversion, users, transcriptions, whatsapp, tickets',
    status: 'done',
    category: 'api',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'api-admin-users',
    title: 'Endpoint GET /admin/users com busca + paginação',
    description: 'Busca por e-mail/nome, retorna subscription + balance',
    status: 'done',
    category: 'api',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'api-admin-tickets',
    title: 'Endpoint GET /admin/tickets com filtro por status',
    description: 'Paginação, ordenação por createdAt desc',
    status: 'done',
    category: 'api',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'api-transcription-atomicity',
    title: 'Débito atômico de minutos via $transaction interativa',
    description: 'Previne race condition + race condition;updateMany com count check',
    status: 'done',
    category: 'api',
    owner: 'Claude',
    priority: 'critical',
    completedAt: '2026-04-23',
  },
  {
    id: 'api-whatsapp-reconnection',
    title: 'Exponential backoff na reconexão WhatsApp',
    description: '5s→5min; log de erro em catch de creds.update',
    status: 'done',
    category: 'api',
    owner: 'Claude',
    priority: 'medium',
    completedAt: '2026-04-23',
  },
  {
    id: 'api-ffmpeg-timeout',
    title: 'FFmpeg timeout 120s com kill SIGKILL',
    description: 'Previne travamentos em áudio corrompido',
    status: 'done',
    category: 'api',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },

  // ── FRONTEND ────────────────────────────────────────────────────────────
  {
    id: 'fe-registration-page',
    title: 'Página de cadastro com documento masking',
    description: 'Valida senhas, mascara CPF/CNPJ, exibe tela pós-registro',
    status: 'done',
    category: 'frontend',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-24',
  },
  {
    id: 'fe-email-confirm-page',
    title: 'Página /email-confirmado (pós-clique no link)',
    description: 'Detecta erros no hash, exibe sucesso ou expirado',
    status: 'done',
    category: 'frontend',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-24',
  },
  {
    id: 'fe-forgot-password',
    title: 'Fluxo frontend "Esqueci a senha"',
    description: 'Página /esqueci-senha + /redefinir-senha com token do hash',
    status: 'done',
    category: 'frontend',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-24',
  },
  {
    id: 'fe-login-error-handling',
    title: 'Login com mensagem clara para e-mail não verificado',
    description: 'Se needsVerification, mostra dica para check spam',
    status: 'done',
    category: 'frontend',
    owner: 'Claude',
    priority: 'medium',
    completedAt: '2026-04-24',
  },
  {
    id: 'fe-dashboard',
    title: 'Dashboard completo do usuário',
    description: '6 páginas: Home, Conversões, Números, Plano, Configurações, Admin',
    status: 'done',
    category: 'frontend',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-02-01',
  },
  {
    id: 'fe-admin-dashboard',
    title: 'Painel admin com 4 abas (Overview, Users, Tickets, Errors)',
    description: 'Componentes reutilizáveis, KPIs, tabelas paginadas',
    status: 'done',
    category: 'frontend',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },

  // ── INFRASTRUCTURE & DEPLOYMENT ──────────────────────────────────────────
  {
    id: 'infra-graceful-shutdown',
    title: 'Graceful shutdown com timeout 30s',
    description: 'API aguarda conexões antes de forçar saída',
    status: 'done',
    category: 'infrastructure',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'infra-redis-health',
    title: '/health endpoint com check Redis',
    description: 'Retorna 503 se Redis indisponível',
    status: 'done',
    category: 'infrastructure',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'infra-buffer-cleanup',
    title: 'Limpeza de buffers (audio.ts, worker.ts)',
    description: 'fill(0) em finally block, previne memory leaks',
    status: 'done',
    category: 'infrastructure',
    owner: 'Claude',
    priority: 'medium',
    completedAt: '2026-04-23',
  },
  {
    id: 'infra-download-timeout',
    title: 'Download timeout 30s com Promise.race',
    description: 'Previne travamentos em download de mídia',
    status: 'done',
    category: 'infrastructure',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'infra-claude-model-update',
    title: 'Atualização modelo Claude (sonnet-4-6)',
    description: 'worker.ts + monitor.ts com modelo mais recente',
    status: 'done',
    category: 'infrastructure',
    owner: 'Claude',
    priority: 'low',
    completedAt: '2026-04-23',
  },

  // ── MONITORING & ALERTING ───────────────────────────────────────────────
  {
    id: 'monitor-health-checks',
    title: 'Monitor de saúde (3x dia: 8h, 14h, 20h BRT)',
    description: 'API + Landing + Dashboard; análise com Claude',
    status: 'done',
    category: 'monitoring',
    owner: 'Claude',
    priority: 'high',
    completedAt: '2026-04-23',
  },
  {
    id: 'monitor-usage-alerts',
    title: 'Alertas de consumo de minutos via WhatsApp',
    description: '50%, 80%, 100% — push automático para usuários',
    status: 'done',
    category: 'monitoring',
    owner: 'Claude',
    priority: 'medium',
    completedAt: '2026-04-23',
  },
  {
    id: 'monitor-webhook-logs',
    title: 'Log de externalReference malformado (Asaas)',
    description: 'Detecta webhooks com ref vazio; não processa',
    status: 'done',
    category: 'monitoring',
    owner: 'Claude',
    priority: 'low',
    completedAt: '2026-04-23',
  },

  // ── PENDING / NICE-TO-HAVE ──────────────────────────────────────────────
  {
    id: 'todo-mfa',
    title: 'MFA (2FA via e-mail ou autenticador)',
    description: 'Segurança adicional para contas de negócios',
    status: 'pending',
    category: 'auth',
    owner: 'Backlog',
    priority: 'medium',
  },
  {
    id: 'todo-password-strength',
    title: 'Validação de força de senha (>8 chars, mix)',
    description: 'Atualmente apenas 6+ caracteres',
    status: 'pending',
    category: 'auth',
    owner: 'Backlog',
    priority: 'low',
  },
  {
    id: 'todo-captcha',
    title: 'CAPTCHA no registro (proteção contra bots)',
    description: 'hCaptcha ou similar',
    status: 'pending',
    category: 'security',
    owner: 'Backlog',
    priority: 'medium',
  },
  {
    id: 'todo-audit-logs',
    title: 'Audit logs de ações sensíveis',
    description: 'Login, mudanças de senha, exclusão de conta',
    status: 'pending',
    category: 'security',
    owner: 'Backlog',
    priority: 'low',
  },
  {
    id: 'todo-billing-webhook-retry',
    title: 'Retry automático de webhooks Asaas falhos',
    description: 'Fallback em caso de 5xx temporários',
    status: 'pending',
    category: 'api',
    owner: 'Backlog',
    priority: 'medium',
  },
  {
    id: 'todo-analytics',
    title: 'Analytics integrado (conversão, churn, CAC)',
    description: 'Dashboard de negócios (não técnico)',
    status: 'pending',
    category: 'infrastructure',
    owner: 'Product',
    priority: 'low',
  },
];

const statusColors: Record<Status, { bg: string; text: string; label: string }> = {
  done:        { bg: 'bg-green-500/10', text: 'text-green-400', label: '✅ Pronto' },
  'in-progress': { bg: 'bg-blue-500/10', text: 'text-blue-400', label: '🔄 Em progresso' },
  pending:     { bg: 'bg-gray-500/10', text: 'text-gray-400', label: '⏳ Pendente' },
};

const categoryLabels: Record<Category, string> = {
  auth: '🔐 Autenticação',
  api: '⚙️ API',
  frontend: '🎨 Frontend',
  security: '🔒 Segurança',
  infrastructure: '🏗️ Infraestrutura',
  monitoring: '📊 Monitoramento',
};

const priorityLabels: Record<string, string> = {
  critical: '🔴 Crítico',
  high: '🟠 Alto',
  medium: '🟡 Médio',
  low: '🟢 Baixo',
};

export default function StatusPage() {
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | Category>('all');

  const filtered = tasks.filter(t => {
    if (filter !== 'all' && t.status !== filter) return false;
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    return true;
  });

  const stats = {
    total: tasks.length,
    done: tasks.filter(t => t.status === 'done').length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    pending: tasks.filter(t => t.status === 'pending').length,
  };

  const percent = Math.round((stats.done / stats.total) * 100);

  return (
    <div className="min-h-screen bg-[#040b09] text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-[#10b981] mb-2">ZapScript — Status & Progresso</h1>
          <p className="text-[#6ee7b7]">Auditoria pré-launch, segurança e correções implementadas</p>
        </div>

        {/* Progress Bar & Stats */}
        <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.15)] rounded-2xl p-8 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Progresso Geral</h2>
            <span className="text-3xl font-bold text-[#10b981]">{percent}%</span>
          </div>
          <div className="w-full bg-[#1a2e2a] rounded-full h-3 mb-6">
            <div
              className="bg-gradient-to-r from-[#10b981] to-[#34d399] h-3 rounded-full transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-[rgba(16,185,129,.05)] rounded-lg p-4">
              <div className="text-sm text-[#6ee7b7] mb-1">Total</div>
              <div className="text-2xl font-bold text-white">{stats.total}</div>
            </div>
            <div className="bg-[rgba(34,197,94,.05)] rounded-lg p-4">
              <div className="text-sm text-green-400 mb-1">Pronto</div>
              <div className="text-2xl font-bold text-green-400">{stats.done}</div>
            </div>
            <div className="bg-[rgba(59,130,246,.05)] rounded-lg p-4">
              <div className="text-sm text-blue-400 mb-1">Em progresso</div>
              <div className="text-2xl font-bold text-blue-400">{stats.inProgress}</div>
            </div>
            <div className="bg-[rgba(107,114,128,.05)] rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-1">Pendente</div>
              <div className="text-2xl font-bold text-gray-400">{stats.pending}</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-8 flex flex-wrap gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === 'all'
                  ? 'bg-[#10b981] text-[#011a12]'
                  : 'bg-[#0d1c19] text-[#6ee7b7] border border-[rgba(16,185,129,.15)] hover:bg-[rgba(16,185,129,.1)]'
              }`}
            >
              Todos ({tasks.length})
            </button>
            <button
              onClick={() => setFilter('done')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === 'done'
                  ? 'bg-green-500 text-white'
                  : 'bg-[#0d1c19] text-[#6ee7b7] border border-[rgba(16,185,129,.15)] hover:bg-[rgba(16,185,129,.1)]'
              }`}
            >
              ✅ Pronto ({stats.done})
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === 'pending'
                  ? 'bg-gray-500 text-white'
                  : 'bg-[#0d1c19] text-[#6ee7b7] border border-[rgba(16,185,129,.15)] hover:bg-[rgba(16,185,129,.1)]'
              }`}
            >
              ⏳ Pendente ({stats.pending})
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              categoryFilter === 'all'
                ? 'bg-[#10b981] text-[#011a12]'
                : 'bg-[#0d1c19] text-[#6ee7b7] border border-[rgba(16,185,129,.15)] hover:bg-[rgba(16,185,129,.1)]'
            }`}
          >
            Todas as categorias
          </button>
          {(Object.entries(categoryLabels) as Array<[Category, string]>).map(([cat, label]) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                categoryFilter === cat
                  ? 'bg-[#10b981] text-[#011a12]'
                  : 'bg-[#0d1c19] text-[#6ee7b7] border border-[rgba(16,185,129,.15)] hover:bg-[rgba(16,185,129,.1)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tasks List */}
        <div className="space-y-3">
          {filtered.map(task => {
            const statusColor = statusColors[task.status];
            return (
              <div key={task.id} className="bg-[#0d1c19] border border-[rgba(16,185,129,.10)] rounded-xl p-6 hover:border-[rgba(16,185,129,.3)] transition">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor.bg} ${statusColor.text}`}>
                        {statusColor.label}
                      </span>
                      <span className="text-xs text-[rgba(16,185,129,.4)]">
                        {categoryLabels[task.category]}
                      </span>
                      <span className="text-xs text-[rgba(16,185,129,.3)]">
                        {priorityLabels[task.priority]}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-1">{task.title}</h3>
                    <p className="text-sm text-[#6ee7b7] mb-3">{task.description}</p>
                    <div className="flex items-center gap-4 text-xs text-[rgba(16,185,129,.5)]">
                      <span>👤 {task.owner}</span>
                      {task.completedAt && (
                        <span>📅 Concluído: {task.completedAt}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[#6ee7b7]">Nenhuma tarefa encontrada com os filtros selecionados.</p>
          </div>
        )}
      </div>
    </div>
  );
}
