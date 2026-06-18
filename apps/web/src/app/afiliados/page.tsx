'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { captureAffiliateFromUrl } from '@/lib/affiliate';

/* ─────────────────────────────────────────────────────────
   Landing pública do Programa de Afiliados.
   O cadastro em si exige conta (self-service em /dashboard/afiliado).
   ───────────────────────────────────────────────────────── */

const KIT: { key: string; label: string; canal: string; text: string }[] = [
  // ── WhatsApp ───────────────────────────────────────────────────────────────
  {
    key: 'zap-formal',
    canal: 'WhatsApp',
    label: 'WhatsApp — formal',
    text: `Olá [nome], tudo bem?\n\nGostaria de indicar uma ferramenta que tenho utilizado e que pode ser bastante útil para o seu dia a dia: o ZapScript.me.\n\nEle conecta ao seu WhatsApp e converte em texto cada áudio recebido automaticamente — texto completo e resumo com IA em segundos. Sem instalar nada, sem salvar áudio.\n\nHá um plano gratuito com 20 minutos por mês, sem necessidade de cartão:\n👉 [SEU_LINK]\n\nFico à disposição se tiver alguma dúvida.`,
  },
  {
    key: 'zap-informal',
    canal: 'WhatsApp',
    label: 'WhatsApp — informal',
    text: `Oi [nome]! Tudo bem?\n\nQueria te indicar uma ferramenta que mudou meu dia a dia: o ZapScript.me.\n\nEle funciona sozinho, converte em texto (e resume) todo áudio que você receber no WhatsApp automaticamente — texto + resumo com IA em segundos.\n\nTem 20 min grátis por mês, sem cartão:\n👉 [SEU_LINK]\n\nSe você recebe muito áudio, vai curtir bastante 😄`,
  },
  // ── Grupos ─────────────────────────────────────────────────────────────────
  {
    key: 'grupo-formal',
    canal: 'Grupo',
    label: 'Grupo de WhatsApp — formal',
    text: `Bom dia, pessoal!\n\nGostaria de compartilhar uma ferramenta que tenho utilizado e que pode ser útil para quem recebe muito áudio no WhatsApp:\n\n*ZapScript.me* — converte automaticamente cada áudio em texto + resumo com IA, em segundos. Sem instalar nada no celular, sem salvar áudio nos servidores.\n\n✅ Funciona sozinho, sem precisar fazer nada\n✅ Texto completo + resumo com os pontos principais\n✅ Servidores no Brasil, conformidade com a LGPD\n✅ Plano gratuito com 20 min/mês, sem cartão\n\n👉 [SEU_LINK]`,
  },
  {
    key: 'grupo-informal',
    canal: 'Grupo',
    label: 'Grupo de WhatsApp — informal',
    text: `Pessoal! 👋 Dica boa aqui:\n\n*ZapScript.me* — transforma áudio do WhatsApp em texto + resumo com IA, automático.\n\nAquele áudio de 4 min que você fica deixando para depois? Você lê em 10 segundos. E o melhor: funciona sozinho, sem precisar fazer nada.\n\n🆓 20 min/mês grátis, sem cartão:\n👉 [SEU_LINK]\n\n🔥 Pro com 200 min por R$19,90 no 1º mês (oferta junho)\n\nValeu! 😄`,
  },
  // ── LinkedIn ───────────────────────────────────────────────────────────────
  {
    key: 'linkedin-formal',
    canal: 'LinkedIn',
    label: 'LinkedIn — formal',
    text: `Compartilhando uma ferramenta que tenho utilizado com resultado concreto na minha rotina:\n\nO *ZapScript.me* converte automaticamente cada áudio do WhatsApp em texto completo + resumo com os pontos principais, em segundos. Sem instalar nada no celular, sem precisar fazer nenhuma ação.\n\nPara quem lida diariamente com muitos áudios — corretores, advogados, gestores, vendedores — o ganho de tempo é significativo.\n\nPlano gratuito disponível com 20 min/mês, sem cartão:\n👉 [SEU_LINK]\n\n#produtividade #ferramentas #IA #WhatsApp`,
  },
  {
    key: 'linkedin-informal',
    canal: 'LinkedIn',
    label: 'LinkedIn — informal',
    text: `Parei de ouvir áudio de WhatsApp no trabalho. De nenhum. 👀\n\nO ZapScript.me converte tudo em texto automaticamente — texto + resumo em segundos. Funciona sozinho, sem precisar fazer nada.\n\nPara quem recebe muito áudio por dia, é um baita ganho de tempo.\n\nTem plano grátis para testar:\n👉 [SEU_LINK]\n\n#produtividade #IA #WhatsApp #dica`,
  },
  // ── Instagram ──────────────────────────────────────────────────────────────
  {
    key: 'instagram-formal',
    canal: 'Instagram',
    label: 'Instagram — formal',
    text: `Ferramenta de IA que converte automaticamente áudios do WhatsApp em texto:\n\n✅ Texto completo + resumo em segundos\n✅ Funciona sozinho, sem nenhuma ação necessária\n✅ 99% de precisão em português BR\n✅ Servidores no Brasil, conformidade com a LGPD\n✅ Plano gratuito com 20 min/mês, sem cartão\n\n🔗 [SEU_LINK] (link na bio)\n\n#produtividade #IA #WhatsApp #tecnologia #ferramentas`,
  },
  {
    key: 'instagram-informal',
    canal: 'Instagram',
    label: 'Instagram — informal',
    text: `Se você também recebe um absurdo de áudio no WhatsApp todo dia… 👀\n\nEssa ferramenta converte tudo em texto automaticamente — resumo com IA em segundos. Funciona sozinho, sem precisar fazer nada.\n\nGrátis para testar 👇\n🔗 [SEU_LINK] (link na bio)\n\n#produtividade #IA #whatsapp #dica`,
  },
  // ── E-mail ─────────────────────────────────────────────────────────────────
  {
    key: 'email-formal',
    canal: 'E-mail',
    label: 'E-mail — formal',
    text: `Assunto: Indicação — ZapScript.me, conversão automática de áudios do WhatsApp em texto\n\nPrezado(a) [nome],\n\nEntro em contato para indicar uma ferramenta que tenho utilizado com bons resultados: o ZapScript.me.\n\nA plataforma conecta ao seu número do WhatsApp e converte automaticamente cada áudio recebido em texto completo + resumo com IA, em segundos. Funciona de forma autônoma, sem qualquer ação necessária da sua parte. O áudio é processado e descartado imediatamente — nada é armazenado.\n\nHá um plano gratuito com 20 minutos por mês, sem necessidade de cartão de crédito:\n👉 [SEU_LINK]\n\nFico à disposição para quaisquer dúvidas.\n\nAtenciosamente,\n[seu nome]`,
  },
  {
    key: 'email-informal',
    canal: 'E-mail',
    label: 'E-mail — informal',
    text: `Assunto: Ferramenta que me fez parar de ouvir áudio de WhatsApp\n\nOi [nome],\n\nQueria te indicar algo que tem funcionado muito bem pra mim.\n\nO ZapScript.me converte automaticamente cada áudio que chega no WhatsApp em texto + resumo com IA, em segundos. Funciona sozinho — nem preciso abrir o app para ver o resultado.\n\nTem plano grátis para testar (20 min/mês, sem cartão):\n👉 [SEU_LINK]\n\nMe conta se curtir!\n\n[seu nome]`,
  },
];

const CANAIS = ['Todos', 'WhatsApp', 'Grupo', 'LinkedIn', 'Instagram', 'E-mail'];

export default function AfiliadosLanding() {
  const [copied, setCopied] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('Todos');

  // Captura o ?aff= e remove o código da barra de endereços
  useEffect(() => { captureAffiliateFromUrl(); }, []);

  function copyKit(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const kitFiltrado = filtro === 'Todos' ? KIT : KIT.filter(m => m.canal === filtro);

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-5 sm:px-8 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <Link href="/"><Image src="/logo.png" alt="ZapScript" width={132} height={28} className="object-contain" /></Link>
        <Link href="/dashboard/afiliado" className="btn-primary px-4 py-2 text-sm">Área do afiliado</Link>
      </header>

      {/* Hero */}
      <section className="px-5 sm:px-8 py-14 sm:py-20 max-w-3xl mx-auto text-center">
        <span className="inline-block text-xs font-mono uppercase tracking-widest text-brand-primary bg-brand-primary/10 rounded-full px-3 py-1 mb-4">
          Programa de Afiliados
        </span>
        <h1 className="text-3xl sm:text-5xl font-black text-brand-text leading-tight">
          Indique o ZapScript e <span className="text-brand-primary">ganhe comissão em dinheiro</span>
        </h1>
        <p className="text-base sm:text-lg text-brand-text-secondary mt-4 max-w-xl mx-auto">
          Compartilhe seu link exclusivo. A cada assinatura paga pelo seu link, você recebe comissão automaticamente — sem burocracia.
        </p>
        <div className="flex gap-3 justify-center mt-7 flex-wrap">
          <Link href="/dashboard/afiliado" className="btn-primary px-6 py-3 text-sm">Quero ser afiliado →</Link>
          <Link href="/cadastro" className="px-6 py-3 text-sm rounded-xl border border-white/15 text-brand-text hover:border-white/30 transition-colors">
            Ainda não tenho conta
          </Link>
        </div>
      </section>

      {/* Comissão — novo modelo único */}
      <section className="px-5 sm:px-8 pb-12 max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-brand-text text-center mb-6">Quanto você ganha</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.20)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">Plano Mensal</div>
            <div className="text-5xl font-black text-brand-primary">50%</div>
            <p className="text-sm text-brand-text-secondary mt-3 leading-relaxed">
              do 1º pagamento mensal do indicado.<br />
              <span className="text-brand-muted text-xs">Ex: indicado assina Pro (R$39,90) → você recebe <strong className="text-brand-primary">R$19,95</strong></span>
            </p>
          </div>
          <div className="rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.15)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">Plano Anual</div>
            <div className="text-5xl font-black text-brand-primary">20%</div>
            <p className="text-sm text-brand-text-secondary mt-3 leading-relaxed">
              do 1º pagamento anual do indicado.<br />
              <span className="text-brand-muted text-xs">Ex: plano anual R$399 → você recebe <strong className="text-brand-primary">R$79,80</strong></span>
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-xl px-5 py-3 text-center text-sm text-brand-muted" style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.12)' }}>
          💳 Pagamentos via Pix nos dias <strong className="text-brand-primary">10 e 25</strong> de cada mês · mínimo R$50,00 acumulado
        </div>
      </section>

      {/* Como funciona */}
      <section className="px-5 sm:px-8 pb-16 max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-brand-text text-center mb-7">Como funciona</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              n: '1',
              t: 'Crie sua conta',
              d: 'Cadastre-se no ZapScript e solicite sua afiliação pelo painel. Aprovação em até 48h.',
            },
            {
              n: '2',
              t: 'Compartilhe seu link',
              d: 'Divulgue seu link exclusivo em grupos, redes sociais, stories e para sua audiência.',
            },
            {
              n: '3',
              t: 'Receba via Pix',
              d: 'A comissão cai no seu extrato automaticamente. Saque via Pix nos dias 10 e 25 (mínimo R$50,00).',
            },
          ].map(s => (
            <div key={s.n} className="rounded-2xl p-5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-9 h-9 rounded-full bg-brand-primary/15 text-brand-primary font-black flex items-center justify-center mx-auto mb-3">{s.n}</div>
              <div className="text-sm font-bold text-brand-text">{s.t}</div>
              <p className="text-xs text-brand-muted mt-1 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>

        {/* Regras e condições resumidas */}
        <div className="mt-8 rounded-2xl p-5 space-y-2 text-xs text-brand-muted" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="font-semibold text-brand-text-secondary text-sm mb-3">Regras e condições</p>
          <p>• Comissão única por indicado (baseada no 1º pagamento do plano escolhido pelo indicado)</p>
          <p>• O indicado deve se cadastrar pelo seu link e realizar o 1º pagamento para gerar comissão</p>
          <p>• Pagamento exclusivamente via Pix para conta de titularidade do CPF/CNPJ cadastrado</p>
          <p>• Saldo mínimo de R$50,00 para solicitar saque</p>
          <p>• Pagamentos processados nos dias 10 e 25 de cada mês</p>
          <p>• A aprovação da afiliação exige e-mail verificado e CPF/CNPJ cadastrado</p>
          <p>• A ZapScript pode recusar ou cancelar afiliações que violem os termos de uso</p>
        </div>

        <div className="text-center mt-10">
          <Link href="/dashboard/afiliado" className="btn-primary px-7 py-3 text-sm">Começar agora →</Link>
        </div>
      </section>

      {/* Kit de divulgação */}
      <section className="px-5 sm:px-8 pb-20 max-w-3xl mx-auto" id="kit">
        <div className="text-center mb-8">
          <span className="inline-block text-xs font-mono uppercase tracking-widest text-brand-primary bg-brand-primary/10 rounded-full px-3 py-1 mb-3">
            Kit de divulgação
          </span>
          <h2 className="text-2xl font-bold text-brand-text">Mensagens prontas para copiar</h2>
          <p className="text-sm text-brand-muted mt-2">Substitua <code className="text-brand-primary bg-brand-primary/10 px-1 rounded">[SEU_LINK]</code> pelo seu link de afiliado (disponível no painel após aprovação).</p>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2 mb-6 justify-center">
          {CANAIS.map(c => (
            <button
              key={c}
              onClick={() => setFiltro(c)}
              className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
              style={filtro === c
                ? { background: 'rgba(16,185,129,1)', color: '#000' }
                : { background: 'rgba(255,255,255,0.06)', color: 'var(--color-muted)' }}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Mensagens */}
        <div className="space-y-4">
          {kitFiltrado.map(m => (
            <div key={m.key} className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}>
                    {m.canal}
                  </span>
                  <span className="text-xs font-semibold text-brand-text-secondary">{m.label}</span>
                </div>
                <button
                  onClick={() => copyKit(m.key, m.text)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={copied === m.key
                    ? { background: 'rgba(16,185,129,.2)', color: '#10b981' }
                    : { background: 'rgba(255,255,255,0.08)', color: 'var(--color-muted)' }}
                >
                  {copied === m.key ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
              <pre className="px-4 py-4 text-xs text-brand-muted leading-relaxed whitespace-pre-wrap font-sans">{m.text}</pre>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link href="/dashboard/afiliado" className="btn-primary px-7 py-3 text-sm">Acessar meu painel →</Link>
        </div>
      </section>

      <footer className="px-5 sm:px-8 py-8 border-t text-center" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-xs text-brand-muted">© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link></p>
      </footer>
    </div>
  );
}
