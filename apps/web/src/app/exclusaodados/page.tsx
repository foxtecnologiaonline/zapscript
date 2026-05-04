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
        <h1 className="text-3xl font-bold mb-2 text-white">Instruções para Exclusão de Dados</h1>
        <p className="text-[#6ee7b7] text-sm mb-8">LGPD Art. 18 — Direito ao esquecimento e exclusão de dados pessoais</p>

        <div className="space-y-8 text-[#a7f3d0]">
          {/* Seção destacada de como fazer */}
          <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-6">
            <h2 className="text-xl font-bold text-green-400 mb-4">📋 Como Solicitar Exclusão</h2>
            <p className="mb-4">Você pode solicitar a exclusão de seus dados de <strong>duas formas</strong>:</p>

            <div className="space-y-4">
              <div className="bg-[#0a1410] p-4 rounded-lg">
                <h3 className="font-bold text-green-400 mb-2">✉️ Opção 1: Por Email (Recomendado)</h3>
                <p className="mb-3">Envie um e-mail para:</p>
                <div className="bg-[#040b09] p-3 rounded border border-green-500/20 font-mono text-sm mb-3">
                  privacidade@zapscript.me
                </div>
                <p className="text-sm">Inclua no e-mail:</p>
                <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                  <li>Seu nome completo</li>
                  <li>E-mail associado à conta ZapScript</li>
                  <li>Assunto: <strong>"SOLICITAÇÃO DE EXCLUSÃO DE DADOS"</strong></li>
                </ul>
              </div>

              <div className="bg-[#0a1410] p-4 rounded-lg">
                <h3 className="font-bold text-green-400 mb-2">📝 Opção 2: Formulário Web</h3>
                <p className="text-sm">Use o formulário abaixo para enviar sua solicitação instantaneamente.</p>
              </div>
            </div>
          </div>

          {/* Seção de direitos */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">🛡️ Seus Direitos (LGPD)</h2>
            <p className="mb-4">Você tem o direito de solicitar:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Acesso:</strong> receber cópia de todos seus dados</li>
              <li><strong>Correção:</strong> corrigir informações incorretas</li>
              <li><strong>Exclusão:</strong> deletar todos seus dados pessoais</li>
              <li><strong>Portabilidade:</strong> exportar dados em formato estruturado</li>
            </ul>
          </section>

          {/* Seção de o que será deletado */}
          <section>
            <h2 className="text-xl font-bold text-white mb-3">🗑️ O que será deletado</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Perfil da conta (nome, CPF/CNPJ)</li>
              <li>Histórico completo de transcrições</li>
              <li>Resumos e textos processados</li>
              <li>Configurações e preferências</li>
              <li>Dados de uso e estatísticas pessoais</li>
            </ul>
          </section>

          {/* Seção de o que NÃO será deletado */}
          <section>
            <h2 className="text-xl font-bold text-white mb-3">⚖️ O que NÃO será deletado (por lei)</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Registros de pagamento (retidos por 5 anos — obrigação fiscal)</li>
              <li>Logs de segurança (retidos por 90 dias — proteção contra fraude)</li>
              <li>Dados anonimizados (não identificáveis)</li>
            </ul>
          </section>

          {/* Formulário */}
          <section>
            <h2 className="text-xl font-bold text-white mb-4">📩 Formulário de Exclusão</h2>

            {enviado ? (
              <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-6">
                <h3 className="text-lg font-bold text-green-400 mb-2">✓ Solicitação Recebida!</h3>
                <p className="mb-3">Sua solicitação de exclusão foi registrada com sucesso.</p>
                <div className="bg-[#0a1410] p-4 rounded border border-green-500/20 space-y-2 text-sm">
                  <p><strong>Próximos passos:</strong></p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Você receberá um e-mail de confirmação em até 24 horas</li>
                    <li>Após confirmação, seus dados serão deletados em até 30 dias</li>
                    <li>Você receberá um e-mail com confirmação de exclusão completa</li>
                  </ul>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="bg-[#0a1410] border border-green-500/20 rounded-xl p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-green-400 mb-2">
                    E-mail associado à conta ZapScript *
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-[#040b09] border border-green-500/30 rounded-lg text-white focus:outline-none focus:border-green-400"
                    placeholder="seu@email.com"
                  />
                  <p className="text-xs text-[#6ee7b7] mt-1">Este e-mail será usado para confirmar sua identidade</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-green-400 mb-2">
                    Motivo da exclusão (opcional)
                  </label>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 bg-[#040b09] border border-green-500/30 rounded-lg text-white focus:outline-none focus:border-green-400 resize-none"
                    placeholder="Nos ajude a melhorar (opcional)..."
                  />
                </div>

                {erro && (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                    <p className="text-red-400 text-sm"><strong>Erro:</strong> {erro}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={carregando || !email}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition"
                >
                  {carregando ? 'Processando...' : 'Enviar Solicitação'}
                </button>

                <p className="text-xs text-[#6ee7b7] text-center border-t border-green-500/20 pt-4">
                  Seus dados serão processados conforme a Lei Geral de Proteção de Dados (LGPD)
                </p>
              </form>
            )}
          </section>

          {/* Prazos */}
          <section>
            <h2 className="text-xl font-bold text-white mb-3">⏱️ Prazos de Processamento</h2>
            <div className="space-y-3">
              <div className="bg-[#0a1410] p-4 rounded border border-green-500/20">
                <p className="font-bold text-green-400">1. Confirmação (até 7 dias)</p>
                <p className="text-sm mt-1">Você receberá um e-mail solicitando confirmação de identidade</p>
              </div>
              <div className="bg-[#0a1410] p-4 rounded border border-green-500/20">
                <p className="font-bold text-green-400">2. Processamento (até 30 dias)</p>
                <p className="text-sm mt-1">Após confirmação, seus dados serão completamente deletados</p>
              </div>
              <div className="bg-[#0a1410] p-4 rounded border border-green-500/20">
                <p className="font-bold text-green-400">3. Confirmação Final (até 2 dias úteis)</p>
                <p className="text-sm mt-1">Você receberá confirmação de exclusão completa</p>
              </div>
            </div>
          </section>

          {/* Suporte */}
          <section className="bg-[#0a1410] border border-green-500/20 rounded-xl p-6">
            <h2 className="text-xl font-bold text-white mb-3">💬 Precisa de Ajuda?</h2>
            <p className="mb-4">Entre em contato conosco:</p>
            <div className="space-y-2">
              <p>📧 <a href="mailto:privacidade@zapscript.me" className="text-green-400 hover:underline">privacidade@zapscript.me</a> — Para questões de privacidade</p>
              <p>📧 <a href="mailto:suporte@zapscript.me" className="text-green-400 hover:underline">suporte@zapscript.me</a> — Suporte geral</p>
              <p className="text-sm text-[#6ee7b7] mt-3">Responderemos em até 2 dias úteis</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
