'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const STEPS = [
  {
    id: 'welcome',
    msg: 'Olá! 👋 Como posso ajudar você hoje?',
    options: [
      { label: '🔧 Problema técnico', next: 'technical' },
      { label: '💳 Questão financeira', next: 'financial' },
      { label: '❓ Dúvida sobre o produto', next: 'question' },
      { label: '📝 Outro assunto', next: 'other' },
    ],
  },
  {
    id: 'technical',
    msg: 'Entendido. Qual é o problema técnico?',
    options: [
      { label: '📱 WhatsApp não conecta', next: 'form', category: 'Problema técnico - WhatsApp' },
      { label: '🎙 Transcrição não chegou', next: 'form', category: 'Problema técnico - Transcrição' },
      { label: '⏱ Minutos sendo debitados errado', next: 'form', category: 'Problema técnico - Minutos' },
      { label: '🔐 Problema de login/acesso', next: 'form', category: 'Problema técnico - Login' },
    ],
  },
  {
    id: 'financial',
    msg: 'Sobre questões financeiras, posso ajudar com:',
    options: [
      { label: '💰 Cobrança indevida', next: 'form', category: 'Financeiro - Cobrança indevida' },
      { label: '🔄 Cancelamento', next: 'form', category: 'Financeiro - Cancelamento' },
      { label: '📄 Nota fiscal', next: 'form', category: 'Financeiro - Nota fiscal' },
    ],
  },
  {
    id: 'question',
    msg: 'Qual é a sua dúvida?',
    options: [
      { label: '📊 Como funcionam os planos', next: 'form', category: 'Dúvida - Planos' },
      { label: '🔗 Integração WhatsApp', next: 'form', category: 'Dúvida - Integração' },
      { label: '🔒 Privacidade dos dados', next: 'form', category: 'Dúvida - Privacidade' },
    ],
  },
  {
    id: 'other',
    msg: 'Pode descrever o assunto?',
    options: [
      { label: '✉️ Enviar mensagem', next: 'form', category: 'Outro' },
    ],
  },
];

export default function SupportWidget() {
  const [open, setOpen]     = useState(false);
  const [step, setStep]     = useState('welcome');
  const [category, setCat]  = useState('');
  const [form, setForm]     = useState({ name: '', email: '', description: '', file: null as File | null });
  const [loading, setLoading] = useState(false);
  const [done, setDone]     = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    // Fetch user data on mount to auto-fill name and email
    api.get<any>('/auth/me')
      .then(user => {
        setForm(f => ({ ...f, name: user.name || '', email: user.email || '' }));
      })
      .catch(() => {/* Usuário não autenticado, permite digitar manualmente */});
  }, []);

  const currentStep = STEPS.find(s => s.id === step);

  function handleOption(opt: any) {
    if (opt.category) setCat(opt.category);
    setStep(opt.next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const formData = new FormData();
      formData.append('name', form.name);
      formData.append('email', form.email);
      formData.append('category', category);
      formData.append('description', form.description);
      if (form.file) {
        formData.append('file', form.file);
      }
      await api.postFormData('/support/ticket', formData);
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setOpen(false);
    setStep('welcome');
    setCat('');
    setForm({ name: '', email: '', description: '', file: null });
    setDone(false);
    setError('');
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-[#10b981] rounded-full shadow-lg flex items-center justify-center text-2xl hover:scale-110 transition-transform"
        style={{ boxShadow: '0 0 24px rgba(16,185,129,.4)' }}
        aria-label="Suporte"
      >
        💬
      </button>

      {/* Chat widget */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 bg-[#0d1c19] border border-[rgba(16,185,129,.20)] rounded-2xl shadow-2xl overflow-hidden"
          style={{ boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#132621] border-b border-[rgba(16,185,129,.10)]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse"/>
              <span className="font-bold text-sm text-[#10b981]">Suporte ZapScript</span>
            </div>
            <button onClick={reset} className="text-[rgba(16,185,129,.4)] hover:text-white text-lg leading-none">✕</button>
          </div>

          <div className="p-4">
            {done ? (
              <div className="text-center py-4">
                <div className="text-3xl mb-3">✅</div>
                <div className="font-bold text-sm text-[#d1fae5] mb-1">Ticket criado!</div>
                <div className="text-xs text-[#6ee7b7] font-light leading-relaxed">
                  Responderemos em até 24 horas no e-mail informado.
                </div>
                <button onClick={reset} className="mt-4 text-xs text-[#10b981] font-semibold hover:underline">
                  Fechar
                </button>
              </div>
            ) : step === 'form' ? (
              <form onSubmit={submit} className="space-y-3">
                <div className="text-xs font-bold text-[#10b981] bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.12)] rounded-lg px-3 py-2">
                  📌 {category}
                </div>
                <div>
                  <input className="w-full bg-[#1a342e] border border-[rgba(16,185,129,.12)] rounded-lg px-3 py-2 text-xs text-[#d1fae5] outline-none placeholder-[rgba(16,185,129,.3)]"
                    placeholder="Seu nome" value={form.name} readOnly disabled/>
                </div>
                <div>
                  <input className="w-full bg-[#1a342e] border border-[rgba(16,185,129,.12)] rounded-lg px-3 py-2 text-xs text-[#d1fae5] outline-none placeholder-[rgba(16,185,129,.3)]"
                    type="email" placeholder="Seu e-mail" value={form.email} readOnly disabled/>
                </div>
                <div>
                  <textarea className="w-full bg-[#1a342e] border border-[rgba(16,185,129,.12)] rounded-lg px-3 py-2 text-xs text-[#d1fae5] outline-none placeholder-[rgba(16,185,129,.3)] resize-none"
                    rows={3} placeholder="Descreva sua situação..." value={form.description}
                    onChange={e => setForm(f => ({...f, description: e.target.value}))} required/>
                </div>
                <div>
                  <label className="text-xs text-[#6ee7b7] font-light mb-1.5 block">Anexar arquivo (opcional)</label>
                  <input type="file"
                    className="w-full text-xs text-[#d1fae5] file:bg-[#10b981] file:text-[#011a12] file:border-0 file:rounded-lg file:px-2 file:py-1 file:text-xs file:font-semibold file:cursor-pointer hover:file:bg-[#34d399] transition-colors"
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.txt"
                    onChange={e => setForm(f => ({...f, file: e.target.files?.[0] || null}))}/>
                  <p className="text-[10px] text-[#4a6e5a] mt-1">Máx 10MB. Formatos: PDF, JPG, PNG, GIF, TXT</p>
                </div>
                {error && <p className="text-red-400 text-[10px]">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep('welcome')}
                    className="text-xs text-[rgba(16,185,129,.4)] hover:text-white transition-colors">← Voltar</button>
                  <button type="submit" disabled={loading}
                    className="flex-1 bg-[#10b981] text-[#011a12] font-bold text-xs py-2 rounded-lg hover:bg-[#34d399] transition-colors disabled:opacity-50">
                    {loading ? 'Enviando...' : 'Enviar para suporte'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="bg-[#132621] rounded-xl px-4 py-3 mb-4">
                  <p className="text-sm text-[#d1fae5] leading-relaxed">{currentStep?.msg}</p>
                </div>
                <div className="space-y-2">
                  {currentStep?.options.map((opt, i) => (
                    <button key={i} onClick={() => handleOption(opt)}
                      className="w-full text-left text-xs font-medium px-3 py-2.5 bg-[#1a342e] border border-[rgba(16,185,129,.10)] rounded-lg text-[#6ee7b7] hover:border-[rgba(16,185,129,.25)] hover:text-white transition-all">
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
