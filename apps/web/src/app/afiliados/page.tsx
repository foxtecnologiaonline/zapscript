'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { captureAffiliateFromUrl } from '@/lib/affiliate';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────
   Landing pública do Programa de Afiliados — Carteira de Crédito
   (Regulamento v4, ver REGULAMENTO_AFILIADOS.md).
   Automático para qualquer usuário desde o cadastro: sem aplicação, sem
   aprovação. Taxa única de 20% sobre cada pagamento do indicado, sem
   tier/bônus/residual (Art. 3º); crédito liberado 30 dias após a confirmação
   do pagamento do indicado (Art. 4º); saldo usável em 3 trilhos (Art. 5º):
   abater fatura, comprar créditos avulsos, sacar em Pix.
   Taxa e regras vêm de GET /wallet/rates (público) — cai no default abaixo
   só se a chamada falhar, pra nunca deixar a LP em branco.

   captureAffiliateFromUrl() continua rodando aqui por compatibilidade com
   links antigos (?aff=) já distribuídos por afiliados aprovados no
   programa anterior, que segue ativo em paralelo até ser descontinuado.
   ───────────────────────────────────────────────────────── */

type WalletRates = {
  rate: number; releaseDays: number; minCashout: number; expiryMonths: number; addonMinutePrice: number;
};
const DEFAULT_RATES: WalletRates = {
  rate: 0.20, releaseDays: 30, minCashout: 50, expiryMonths: 12, addonMinutePrice: 0.19,
};
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function buildFaq(r: WalletRates): { q: string; a: string }[] {
  const pct = Math.round(r.rate * 100);
  return [
    {
      q: 'Preciso me aplicar ou esperar aprovação?',
      a: 'Não. Toda conta já nasce com carteira e link de indicação próprio — é só compartilhar. Não existe fila de aprovação.',
    },
    {
      q: 'O que acontece se o meu indicado cancelar?',
      a: 'Se ele cancelar até 30 dias após o pagamento, o crédito correspondente simplesmente não chega a ser gerado. Depois desse prazo, o crédito já lançado é seu — não é revertido.',
    },
    {
      q: `Quando o crédito fica disponível?`,
      a: `${r.releaseDays} dias após a confirmação do pagamento do seu indicado. Depois disso, o saldo já está liberado para qualquer um dos 3 usos, sem carência adicional.`,
    },
    {
      q: `A comissão de ${pct}% é só na primeira venda?`,
      a: `Não. Você recebe ${pct}% em todo pagamento aprovado do seu indicado (mensal ou anual), enquanto ele continuar assinante — sem prazo de corte.`,
    },
    {
      q: 'O que posso fazer com o saldo?',
      a: 'Três formas, sempre no câmbio de 1 crédito = R$ 1: abater a sua própria fatura, comprar créditos avulsos (minutos extras), ou sacar em dinheiro via Pix.',
    },
    {
      q: 'Tem valor mínimo?',
      a: `Só para sacar em dinheiro: R$ ${r.minCashout}. Abater fatura e comprar avulso não têm mínimo.`,
    },
  ];
}

const KIT: { key: string; label: string; canal: string; text: string }[] = [
  // ── WhatsApp ───────────────────────────────────────────────────────────────
  {
    key: 'zap-formal',
    canal: 'WhatsApp',
    label: 'WhatsApp — formal',
    text: `Olá [nome], tudo bem?\n\nGostaria de indicar uma ferramenta que tenho utilizado e que pode ser bastante útil para o seu dia a dia: o ZapScript.me.\n\nEle conecta ao seu WhatsApp e converte em texto cada áudio recebido automaticamente — texto completo e resumo com IA em segundos. Sem instalar nada, sem salvar áudio.\n\nHá um plano gratuito, sem necessidade de cartão:\n👉 [SEU_LINK]\n\nFico à disposição se tiver alguma dúvida.`,
  },
  {
    key: 'zap-informal',
    canal: 'WhatsApp',
    label: 'WhatsApp — informal',
    text: `Oi [nome]! Tudo bem?\n\nQueria te indicar uma ferramenta que mudou meu dia a dia: o ZapScript.me.\n\nÉ tipo um robô particular que converte em texto (e resume) todo áudio que você recebe no WhatsApp — 24 horas por dia, automaticamente, em segundos.\n\nTem plano grátis, sem cartão:\n👉 [SEU_LINK]\n\nSe você recebe muito áudio, vai curtir bastante 😄`,
  },
  // ── Grupos ─────────────────────────────────────────────────────────────────
  {
    key: 'grupo-formal',
    canal: 'Grupo',
    label: 'Grupo de WhatsApp — formal',
    text: `Bom dia, pessoal!\n\nGostaria de compartilhar uma ferramenta que tenho utilizado e que pode ser útil para quem recebe muito áudio no WhatsApp:\n\n*ZapScript.me* — converte automaticamente cada áudio em texto + resumo com IA, em segundos. Sem instalar nada no celular, sem salvar áudio nos servidores.\n\n✅ Funciona sozinho, sem precisar fazer nada\n✅ Texto completo + resumo com os pontos principais\n✅ Servidores no Brasil, conformidade com a LGPD\n✅ Plano gratuito, sem cartão\n\n👉 [SEU_LINK]`,
  },
  {
    key: 'grupo-informal',
    canal: 'Grupo',
    label: 'Grupo de WhatsApp — informal',
    text: `Pessoal! 👋 Dica boa aqui:\n\n*ZapScript.me* — transforma áudio do WhatsApp em texto + resumo com IA, automático.\n\nAquele áudio de 4 min que você fica deixando para depois? Você lê em 10 segundos. E o melhor: funciona sozinho, sem precisar fazer nada.\n\n🆓 Grátis pra testar, sem cartão:\n👉 [SEU_LINK]\n\nValeu! 😄`,
  },
  // ── LinkedIn ───────────────────────────────────────────────────────────────
  {
    key: 'linkedin-formal',
    canal: 'LinkedIn',
    label: 'LinkedIn — formal',
    text: `Compartilhando uma ferramenta que tenho utilizado com resultado concreto na minha rotina:\n\nO *ZapScript.me* converte automaticamente cada áudio do WhatsApp em texto completo + resumo com os pontos principais, em segundos. Sem instalar nada no celular, sem precisar fazer nenhuma ação.\n\nPara quem lida diariamente com muitos áudios — corretores, advogados, gestores, vendedores — o ganho de tempo é significativo.\n\nPlano gratuito disponível, sem cartão:\n👉 [SEU_LINK]\n\n#produtividade #ferramentas #IA #WhatsApp`,
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
    text: `Ferramenta de IA que converte automaticamente áudios do WhatsApp em texto:\n\n✅ Texto completo + resumo em segundos\n✅ Funciona sozinho, sem nenhuma ação necessária\n✅ 99% de precisão em português BR\n✅ Servidores no Brasil, conformidade com a LGPD\n✅ Plano gratuito, sem cartão\n\n🔗 [SEU_LINK] (link na bio)\n\n#produtividade #IA #WhatsApp #tecnologia #ferramentas`,
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
    text: `Assunto: Indicação — ZapScript.me, conversão automática de áudios do WhatsApp em texto\n\nPrezado(a) [nome],\n\nEntro em contato para indicar uma ferramenta que tenho utilizado com bons resultados: o ZapScript.me.\n\nA plataforma conecta ao seu número do WhatsApp e converte automaticamente cada áudio recebido em texto completo + resumo com IA, em segundos. Funciona de forma autônoma, sem qualquer ação necessária da sua parte. O áudio é processado e descartado imediatamente — nada é armazenado.\n\nHá um plano gratuito, sem necessidade de cartão de crédito:\n👉 [SEU_LINK]\n\nFico à disposição para quaisquer dúvidas.\n\nAtenciosamente,\n[seu nome]`,
  },
  {
    key: 'email-informal',
    canal: 'E-mail',
    label: 'E-mail — informal',
    text: `Assunto: Ferramenta que me fez parar de ouvir áudio de WhatsApp\n\nOi [nome],\n\nQueria te indicar algo que tem funcionado muito bem pra mim.\n\nO ZapScript.me converte automaticamente cada áudio que chega no WhatsApp em texto + resumo com IA, em segundos. Funciona sozinho — nem preciso abrir o app para ver o resultado.\n\nTem plano grátis para testar, sem cartão:\n👉 [SEU_LINK]\n\nMe conta se curtir!\n\n[seu nome]`,
  },
];

const CANAIS = ['Todos', 'WhatsApp', 'Grupo', 'LinkedIn', 'Instagram', 'E-mail'];

export default function AfiliadosLanding() {
  const [copied, setCopied] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('Todos');
  const [rates, setRates] = useState<WalletRates>(DEFAULT_RATES);
  const [planValue, setPlanValue] = useState(49);
  const [referralsPerMonth, setReferralsPerMonth] = useState(5);

  // Captura o ?aff= (programa antigo, ainda ativo em paralelo) e remove da barra de endereços
  useEffect(() => { captureAffiliateFromUrl(); }, []);

  // Taxa real da carteira (admin pode alterar sem redeploy) — cai no default se falhar
  useEffect(() => { api.get<WalletRates>('/wallet/rates').then(setRates).catch(() => {}); }, []);

  function copyKit(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const kitFiltrado = filtro === 'Todos' ? KIT : KIT.filter(m => m.canal === filtro);
  const faq = buildFaq(rates);
  const pct = Math.round(rates.rate * 100);

  const perReferralMonthly = planValue * rates.rate;
  const steadyStateMonthly = referralsPerMonth * perReferralMonthly;

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-5 sm:px-8 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <Link href="/"><Image src="/logo.png" alt="ZapScript" width={132} height={28} className="object-contain" /></Link>
        <Link href="/dashboard/afiliado" className="btn-primary px-4 py-2 text-sm">Minha carteira</Link>
      </header>

      {/* Hero */}
      <section className="px-5 sm:px-8 py-14 sm:py-20 max-w-3xl mx-auto text-center">
        <span className="inline-block text-xs font-mono uppercase tracking-widest text-brand-primary bg-brand-primary/10 rounded-full px-3 py-1 mb-4">
          Programa de Afiliados
        </span>
        <h1 className="text-3xl sm:text-5xl font-black text-brand-text leading-tight">
          Indique o ZapScript e <span className="text-brand-primary">ganhe crédito todo mês</span>
        </h1>
        <p className="text-base sm:text-lg text-brand-text-secondary mt-4 max-w-xl mx-auto">
          Toda conta já tem link de indicação — sem aplicação, sem aprovação. Você recebe {pct}% em cada pagamento
          de quem indicar, todo mês, sem prazo de corte.
        </p>
        <p className="text-sm text-brand-primary font-medium mt-3 max-w-xl mx-auto">
          Você indica um robô que converte áudio em texto 24 horas por dia — um produto que se explica sozinho.
        </p>
        <div className="flex justify-center mt-5">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}>
            💰 Crédito liberado {rates.releaseDays} dias após o pagamento do indicado
          </span>
        </div>
        <div className="flex gap-3 justify-center mt-7 flex-wrap">
          <Link href="/cadastro" className="btn-primary px-6 py-3 text-sm font-bold">CRIAR CONTA GRÁTIS →</Link>
          <Link href="/dashboard/afiliado" className="px-6 py-3 text-sm rounded-xl border border-white/15 text-brand-text hover:border-white/30 transition-colors">
            Já tenho conta — ver carteira
          </Link>
        </div>
      </section>

      {/* Comissão — modelo automático */}
      <section className="px-5 sm:px-8 pb-12 max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-brand-text text-center mb-2">Quanto você ganha</h2>
        <p className="text-sm text-brand-muted text-center mb-6 max-w-lg mx-auto">
          Taxa única, recorrente, sem degrau — não precisa bater meta pra ganhar mais.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <CommCard emoji="💰" title={`${pct}%`} sub="sobre cada pagamento" detail="Enquanto o indicado continuar assinante — mensal ou anual, sem prazo de corte." />
          <CommCard emoji="⏱️" title={`D+${rates.releaseDays}`} sub="liberação do crédito" detail="Contado a partir da confirmação do pagamento do seu indicado." />
          <CommCard emoji="🔀" title="3 usos" sub="pro seu saldo" detail="Abater fatura, comprar avulso ou sacar em Pix — 1 crédito = R$ 1 em qualquer um." />
        </div>

        {/* Simulador ao vivo — usa a taxa real (GET /wallet/rates) */}
        <div className="mt-6 rounded-2xl p-5 sm:p-6" style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.12)' }}>
          <p className="text-sm font-bold text-brand-text text-center mb-4">Simule quanto você pode ganhar</p>
          <div className="grid sm:grid-cols-2 gap-4 max-w-md mx-auto">
            <label className="text-xs text-brand-muted">
              Plano do seu indicado (R$/mês)
              <input
                type="number" min={0} step="0.01" value={planValue}
                onChange={e => setPlanValue(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm text-brand-text bg-black/20 border border-white/10 focus:outline-none focus:border-brand-primary/50"
              />
            </label>
            <label className="text-xs text-brand-muted">
              Indicados ativos por mês
              <input
                type="number" min={0} step={1} value={referralsPerMonth}
                onChange={e => setReferralsPerMonth(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm text-brand-text bg-black/20 border border-white/10 focus:outline-none focus:border-brand-primary/50"
              />
            </label>
          </div>
          <div className="text-sm text-brand-text-secondary text-center leading-relaxed mt-5 space-y-1.5">
            <p>
              Por indicado: <strong className="text-brand-primary">{brl(perReferralMonthly)}/mês</strong>, enquanto ele continuar assinante.
            </p>
            {referralsPerMonth > 0 && (
              <p>
                Com <strong>{referralsPerMonth}</strong> indicado{referralsPerMonth === 1 ? '' : 's'} ativo{referralsPerMonth === 1 ? '' : 's'}/mês, seu crédito mensal pode chegar a{' '}
                <strong className="text-brand-primary text-base">{brl(steadyStateMonthly)}</strong>.
              </p>
            )}
          </div>
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
              d: 'Toda conta já nasce com carteira e link de indicação — sem aplicação, sem espera.',
            },
            {
              n: '2',
              t: 'Compartilhe seu link',
              d: 'Divulgue seu link exclusivo em grupos, redes sociais, stories e para sua audiência.',
            },
            {
              n: '3',
              t: 'Use seu crédito',
              d: 'A cada pagamento do indicado, o crédito entra na sua carteira. Abata fatura, compre avulso ou saque em Pix.',
            },
          ].map(s => (
            <div key={s.n} className="rounded-2xl p-5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-9 h-9 rounded-full bg-brand-primary/15 text-brand-primary font-black flex items-center justify-center mx-auto mb-3">{s.n}</div>
              <div className="text-sm font-bold text-brand-text">{s.t}</div>
              <p className="text-xs text-brand-muted mt-1 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>

        {/* Regras e condições resumidas — REGULAMENTO_AFILIADOS.md */}
        <div className="mt-8 rounded-2xl p-5 space-y-2 text-xs text-brand-muted" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="font-semibold text-brand-text-secondary text-sm mb-3">Regras e condições</p>
          <p>• Toda conta ativa e com e-mail verificado já tem carteira e link de indicação — sem aplicação, sem aprovação</p>
          <p>• Comissão de {pct}% sobre cada pagamento aprovado do indicado (mensal ou anual), enquanto ele continuar assinante</p>
          <p>• Crédito lançado na carteira {rates.releaseDays} dias após a confirmação do pagamento do indicado</p>
          <p>• Cancelamento do indicado dentro desses {rates.releaseDays} dias: o crédito correspondente não chega a ser gerado; depois disso, nada é revertido</p>
          <p>• Saldo disponível em 3 usos, câmbio fixo 1 crédito = R$ 1: abater fatura, comprar créditos avulsos, ou sacar via Pix (mínimo R$ {rates.minCashout})</p>
          <p>• Crédito não utilizado expira {rates.expiryMonths} meses após a geração, com aviso prévio</p>
          <p>• Proibida autoindicação e contas fictícias — infração cancela os créditos irregulares</p>
          <p>• Regulamento completo: <Link href="/regulamento-afiliados" className="text-brand-primary hover:underline">ver todos os artigos</Link></p>
        </div>

        <div className="text-center mt-10">
          <Link href="/cadastro" className="btn-primary px-7 py-3 text-sm">Começar agora →</Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-5 sm:px-8 pb-16 max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-brand-text text-center mb-7">Perguntas frequentes</h2>
        <div className="space-y-3">
          {faq.map(f => (
            <div key={f.q} className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-sm font-bold text-brand-text">{f.q}</p>
              <p className="text-xs text-brand-muted mt-1.5 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Kit de divulgação */}
      <section className="px-5 sm:px-8 pb-20 max-w-3xl mx-auto" id="kit">
        <div className="text-center mb-8">
          <span className="inline-block text-xs font-mono uppercase tracking-widest text-brand-primary bg-brand-primary/10 rounded-full px-3 py-1 mb-3">
            Kit de divulgação
          </span>
          <h2 className="text-2xl font-bold text-brand-text">Mensagens prontas para copiar</h2>
          <p className="text-sm text-brand-muted mt-2">Substitua <code className="text-brand-primary bg-brand-primary/10 px-1 rounded">[SEU_LINK]</code> pelo seu link de indicação (disponível no seu painel assim que você cria a conta).</p>
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
          <Link href="/dashboard/afiliado" className="btn-primary px-7 py-3 text-sm">Acessar minha carteira →</Link>
        </div>
      </section>

      <footer className="px-5 sm:px-8 py-8 border-t text-center" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-xs text-brand-muted">© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link></p>
      </footer>
    </div>
  );
}

function CommCard({ emoji, title, sub, detail }: { emoji: string; title: string; sub: string; detail: string }) {
  return (
    <div className="rounded-2xl p-4 sm:p-5 text-center" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.15)' }}>
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="text-3xl sm:text-4xl font-black text-brand-primary">{title}</div>
      <div className="text-[11px] font-semibold text-brand-text-secondary mt-1 uppercase tracking-wide">{sub}</div>
      <p className="text-xs text-brand-muted mt-2 leading-relaxed">{detail}</p>
    </div>
  );
}
