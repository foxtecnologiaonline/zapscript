import Link from 'next/link';

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-[#040b09] px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-green-400 text-sm mb-8 inline-block hover:underline">← Voltar</Link>
        <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
        <p className="text-[#6ee7b7] text-sm mb-8">Última atualização: abril de 2026 — Conformidade LGPD</p>

        <div className="space-y-6 text-[#a7f3d0]">
          <section>
            <h2 className="text-xl font-bold text-white mb-3">Dados que coletamos</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Cadastro:</strong> nome, e-mail, CPF/CNPJ (para verificação de identidade)</li>
              <li><strong>Transcrições:</strong> texto transcrito e resumo em bullets (áudios NUNCA são armazenados)</li>
              <li><strong>Uso:</strong> minutos utilizados, data/hora das transcrições, número de contato</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">🔒 Sobre os áudios — IMPORTANTE</h2>
            <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4">
              <p className="font-bold text-green-400 mb-2">Os áudios NUNCA são armazenados.</p>
              <p>Todo processamento de áudio ocorre exclusivamente em memória RAM. Após a transcrição ser concluída, o buffer de áudio é apagado imediatamente. Nenhum arquivo de áudio é gravado em disco ou enviado a terceiros além das APIs de transcrição (OpenAI Whisper).</p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">Seus direitos (LGPD)</h2>
            <p>Você tem direito a: acessar seus dados, corrigir informações incorretas, solicitar exclusão da conta e exportar seus dados. Entre em contato: <a href="mailto:privacidade@zapscript.me" className="text-green-400">privacidade@zapscript.me</a></p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">Terceiros</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>OpenAI Whisper:</strong> transcrição de áudio (dados processados e descartados)</li>
              <li><strong>Anthropic Claude:</strong> geração de resumos em texto</li>
              <li><strong>Stripe:</strong> processamento de pagamentos</li>
              <li><strong>Supabase:</strong> armazenamento do banco de dados</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
