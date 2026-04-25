import Link from 'next/link';

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-[#040b09] px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-green-400 text-sm mb-8 inline-block hover:underline">← Voltar</Link>
        <h1 className="text-3xl font-bold mb-2">Termos de Uso</h1>
        <p className="text-[#6ee7b7] text-sm mb-8">Última atualização: abril de 2026</p>

        <div className="prose prose-invert max-w-none space-y-6 text-[#a7f3d0]">
          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Sobre o ZapScript</h2>
            <p>ZapScript é um serviço de transcrição e resumo automático de mensagens de voz do WhatsApp, utilizando inteligência artificial. <strong>ZapScript não é afiliado, associado, autorizado, endossado por, ou de qualquer forma oficialmente conectado à Meta Platforms, Inc. ou ao WhatsApp.</strong> WhatsApp é marca registrada da Meta Platforms, Inc.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Uso Aceitável</h2>
            <p>Ao utilizar o ZapScript, você concorda em: (a) usar o serviço apenas para fins legítimos e legais; (b) não compartilhar credenciais de acesso; (c) respeitar a privacidade de terceiros cujos áudios possam ser transcritos.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. Privacidade e Áudios</h2>
            <p>Os áudios enviados ao ZapScript são processados exclusivamente em memória e <strong>nunca são armazenados</strong> em nossos servidores. Apenas o texto transcrito e o resumo são salvos, se e enquanto o usuário mantiver sua conta ativa.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Planos e Cobrança</h2>
            <p>Os planos pagos (Pro e Ultra) são cobrados mensalmente via Stripe. Cancelamentos podem ser feitos a qualquer momento. Minutos não utilizados acumulam para o próximo mês enquanto a assinatura estiver ativa.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Limitação de Responsabilidade</h2>
            <p>O ZapScript é fornecido "como está". Não garantimos 100% de precisão nas transcrições. Não somos responsáveis por decisões tomadas com base em transcrições geradas automaticamente.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Contato</h2>
            <p>Para dúvidas sobre estes termos: <a href="mailto:contato@zapscript.me" className="text-green-400">contato@zapscript.me</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
