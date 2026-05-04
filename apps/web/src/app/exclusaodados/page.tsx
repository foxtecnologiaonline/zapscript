'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function ExclusaoDadosPage() {
  const [email, setEmail] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    setErro('');

    try {
      // Enviando solicitação de exclusão para o backend
      const response = await fetch('/api/user/request-deletion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          motivo,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Erro ao processar solicitação');
      }

      setEnviado(true);
      setEmail('');
      setMotivo('');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#040b09] px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-green-400 text-sm mb-8 inline-block hover:underline">
          ← Voltar
        </Link>
        <h1 className="text-3xl font-bold mb-2 text-white">Solicitação de Exclusão de Dados</h1>
        <p className="text-[#6ee7b7] text-sm mb-8">Conformidade LGPD — Direito ao esquecimento</p>

        <div className="space-y-6 text-[#a7f3d0]">
          <section>
            <h2 className="text-xl font-bold text-white mb-3">Seus direitos</h2>
            <p>De acordo com a Lei Geral de Proteção de Dados (LGPD), você tem o direito de solicitar a exclusão de todos os seus dados pessoais armazenados no ZapScript.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">O que será deletado</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Perfil da conta (nome, e-mail, CPF/CNPJ)</li>
              <li>Histórico de transcrições</li>
              <li>Resumos de áudio armazenados</li>
              <li>Dados de uso e faturamento</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">O que NÃO será deletado</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Registros de pagamento (retidos por obrigação legal contábil/fiscal — 5 anos)</li>
              <li>Logs de segurança (retidos por 90 dias por segurança)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">Como solicitar</h2>
            <p className="mb-6">Preencha o formulário abaixo ou envie um e-mail para <a href="mailto:privacidade@zapscript.me" className="text-green-400 hover:underline">privacidade@zapscript.me</a> com a palavra-chave <strong>DELETAR MINHA CONTA</strong>.</p>

            {enviado ? (
              <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-6">
                <h3 className="text-lg font-bold text-green-400 mb-2">✓ Solicitação recebida!</h3>
                <p>Sua solicitação foi registrada. Você receberá um e-mail de confirmação em breve. A exclusão será processada dentro de 30 dias, conforme exigido pela LGPD.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="bg-[#0a1410] border border-green-500/20 rounded-xl p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-green-400 mb-2">
                    E-mail associado à conta *
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-[#040b09] border border-green-500/30 rounded-lg text-white focus:outline-none focus:border-green-400"
                    placeholder="seu@email.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-green-400 mb-2">
                    Motivo da exclusão (opcional)
                  </label>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 bg-[#040b09] border border-green-500/30 rounded-lg text-white focus:outline-none focus:border-green-400"
                    placeholder="Nos ajude a melhorar (opcional)..."
                  />
                </div>

                {erro && (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3">
                    <p className="text-red-400 text-sm">{erro}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={carregando || !email}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition"
                >
                  {carregando ? 'Processando...' : 'Solicitar Exclusão'}
                </button>

                <p className="text-xs text-[#6ee7b7] text-center">
                  Sua privacidade é importante para nós. Processaremos sua solicitação conforme exigido pela lei.
                </p>
              </form>
            )}
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">Prazos</h2>
            <p>Após a confirmação, você tem direito a:</p>
            <ul className="list-disc list-inside space-y-2 mt-3">
              <li><strong>Confirmação:</strong> resposta por e-mail em até 7 dias</li>
              <li><strong>Processamento:</strong> exclusão completa em até 30 dias (conforme LGPD)</li>
              <li><strong>Confirmação final:</strong> confirmação de exclusão por e-mail</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">Dúvidas?</h2>
            <p>Entre em contato: <a href="mailto:privacidade@zapscript.me" className="text-green-400 hover:underline">privacidade@zapscript.me</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
