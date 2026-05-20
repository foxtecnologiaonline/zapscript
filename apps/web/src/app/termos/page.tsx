import Link from 'next/link';

export const metadata = {
  title: 'Termos de Uso | ZapScript',
  robots: { index: true, follow: true },
};

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-[#040b09] px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-green-400 text-sm mb-8 inline-block hover:underline">← Voltar</Link>
        <h1 className="text-3xl font-bold mb-2">Termos de Uso</h1>
        <p className="text-[#6ee7b7] text-sm mb-8">Última atualização: maio de 2026</p>

        <div className="prose prose-invert max-w-none space-y-6 text-[#a7f3d0]">
          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Sobre o ZapScript</h2>
            <p>ZapScript é um serviço de transcrição e resumo automático de mensagens de voz do WhatsApp, desenvolvido e operado por <strong>FOX TecnologIA</strong>. <strong>ZapScript não é afiliado, associado, autorizado, endossado ou de qualquer forma oficialmente conectado à Meta Platforms, Inc. ou ao WhatsApp.</strong> WhatsApp é marca registrada da Meta Platforms, Inc.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Uso Aceitável</h2>
            <p>Ao utilizar o ZapScript, você concorda em: (a) usar o serviço apenas para fins legítimos e legais; (b) não compartilhar credenciais de acesso; (c) respeitar a privacidade de terceiros cujos áudios possam ser transcritos; (d) não utilizar o serviço para spam, assédio ou atividades ilegais.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. Privacidade e Áudios</h2>
            <p>Os áudios enviados ao ZapScript são processados exclusivamente em memória e <strong>nunca são armazenados</strong> em nossos servidores. Apenas o texto transcrito e o resumo são salvos, de forma criptografada, enquanto o usuário mantiver sua conta ativa.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Planos e Cobrança</h2>
            <p>Os planos pagos (Pro e Ultra) são cobrados mensalmente via <strong>Asaas</strong> (plataforma brasileira de pagamentos). Cancelamentos podem ser feitos a qualquer momento pelo painel. Minutos não utilizados não são acumulados entre ciclos.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Propriedade Intelectual</h2>
            <p>Todo o código-fonte, design, marca, logotipo, textos, interfaces e demais elementos do ZapScript são de propriedade exclusiva da <strong>FOX TecnologIA</strong> e estão protegidos pelas leis brasileiras e internacionais de direitos autorais (Lei nº 9.610/1998) e propriedade industrial (Lei nº 9.279/1996).</p>
            <p className="mt-3">É <strong>expressamente proibido</strong>: (a) copiar, reproduzir, modificar ou distribuir qualquer parte do sistema sem autorização escrita prévia; (b) realizar engenharia reversa, descompilar ou tentar extrair o código-fonte; (c) criar produtos derivados ou concorrentes baseados no ZapScript; (d) usar técnicas de scraping, crawling ou automação para coletar dados do sistema.</p>
            <p className="mt-3">Violações serão tratadas nos termos da legislação aplicável, incluindo medidas judiciais cabíveis.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Limitação de Responsabilidade</h2>
            <p>O ZapScript é fornecido "como está". Não garantimos 100% de precisão nas transcrições. Não somos responsáveis por decisões tomadas com base em transcrições geradas automaticamente.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">7. Contato</h2>
            <p>Para dúvidas sobre estes termos ou notificações de violação de direitos: <a href="mailto:contato@zapscript.me" className="text-green-400">contato@zapscript.me</a></p>
          </section>
        </div>

        <p className="text-xs text-[#4b7a5e] mt-12 border-t border-[#0d2a1f] pt-6">
          © 2026 ZapScript / FOX TecnologIA. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
