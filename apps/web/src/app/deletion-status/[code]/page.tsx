'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface DeletionStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  confirmationCode: string;
  requestedAt: string;
  expectedCompletionDate: string;
  message: string;
}

export default function DeletionStatusPage({ params }: { params: { code: string } }) {
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/deletion-status/${params.code}`);

        if (!response.ok) {
          throw new Error('Status não encontrado');
        }

        const data = await response.json();
        setStatus(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao buscar status');
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [params.code]);

  return (
    <div className="min-h-screen bg-[#040b09] px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-green-400 text-sm mb-8 inline-block hover:underline">
          ← Voltar
        </Link>

        <h1 className="text-3xl font-bold mb-2 text-white">Status de Exclusão de Dados</h1>
        <p className="text-[#6ee7b7] text-sm mb-8">Acompanhe o andamento da sua solicitação</p>

        {loading ? (
          <div className="bg-[#0a1410] border border-green-500/20 rounded-xl p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mb-4"></div>
            <p className="text-[#a7f3d0]">Carregando status...</p>
          </div>
        ) : error ? (
          <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-6">
            <h2 className="text-lg font-bold text-red-400 mb-2">❌ Erro</h2>
            <p className="text-red-300">{error}</p>
            <p className="text-sm text-red-200 mt-4">
              Se o problema persistir, entre em contato: <a href="mailto:privacidade@zapscript.me" className="text-red-400 hover:underline">privacidade@zapscript.me</a>
            </p>
          </div>
        ) : status ? (
          <div className="space-y-6">
            {/* Card principal de status */}
            <div className={`border rounded-xl p-6 ${
              status.status === 'completed'
                ? 'bg-green-900/20 border-green-500/30'
                : status.status === 'failed'
                ? 'bg-red-900/20 border-red-500/30'
                : 'bg-blue-900/20 border-blue-500/30'
            }`}>
              <div className="flex items-start gap-4">
                <div className="text-4xl">
                  {status.status === 'completed' && '✓'}
                  {status.status === 'processing' && '⏳'}
                  {status.status === 'pending' && '📋'}
                  {status.status === 'failed' && '❌'}
                </div>
                <div className="flex-1">
                  <h2 className={`text-2xl font-bold mb-2 ${
                    status.status === 'completed'
                      ? 'text-green-400'
                      : status.status === 'failed'
                      ? 'text-red-400'
                      : 'text-blue-400'
                  }`}>
                    {status.status === 'completed' && 'Exclusão Concluída'}
                    {status.status === 'processing' && 'Processando Exclusão'}
                    {status.status === 'pending' && 'Exclusão Pendente'}
                    {status.status === 'failed' && 'Erro na Exclusão'}
                  </h2>
                  <p className="text-[#a7f3d0]">{status.message}</p>
                </div>
              </div>
            </div>

            {/* Informações de rastreamento */}
            <div className="bg-[#0a1410] border border-green-500/20 rounded-xl p-6 space-y-4">
              <h3 className="text-lg font-bold text-green-400 mb-4">📊 Detalhes da Solicitação</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-[#6ee7b7] mb-1">Código de Confirmação</p>
                  <p className="font-mono text-sm text-white bg-[#040b09] p-3 rounded border border-green-500/20 break-all">
                    {status.confirmationCode}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-[#6ee7b7] mb-1">Data da Solicitação</p>
                  <p className="text-white">
                    {new Date(status.requestedAt).toLocaleDateString('pt-BR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>

                <div className="md:col-span-2">
                  <p className="text-sm text-[#6ee7b7] mb-1">Previsão de Conclusão</p>
                  <p className="text-white">
                    {new Date(status.expectedCompletionDate).toLocaleDateString('pt-BR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* Timeline de processo */}
            <div className="bg-[#0a1410] border border-green-500/20 rounded-xl p-6">
              <h3 className="text-lg font-bold text-green-400 mb-4">⏱️ Linha do Tempo</h3>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-4 h-4 rounded-full ${status.status !== 'pending' ? 'bg-green-400' : 'bg-gray-600'}`}></div>
                    <div className={`w-0.5 h-12 ${status.status === 'failed' ? 'bg-red-600' : status.status !== 'pending' ? 'bg-green-400' : 'bg-gray-600'}`}></div>
                  </div>
                  <div>
                    <p className="font-bold text-green-400">Solicitação Recebida</p>
                    <p className="text-sm text-[#6ee7b7]">Sua solicitação foi registrada com sucesso</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-4 h-4 rounded-full ${
                      status.status === 'completed' || status.status === 'processing' || status.status === 'failed'
                        ? 'bg-green-400'
                        : 'bg-gray-600'
                    }`}></div>
                    <div className={`w-0.5 h-12 ${status.status === 'failed' ? 'bg-red-600' : status.status === 'completed' || status.status === 'processing' ? 'bg-green-400' : 'bg-gray-600'}`}></div>
                  </div>
                  <div>
                    <p className="font-bold text-green-400">Processando</p>
                    <p className="text-sm text-[#6ee7b7]">
                      {status.status === 'processing' || status.status === 'completed' ? 'Em andamento' : 'Aguardando'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-4 h-4 rounded-full ${
                      status.status === 'completed' ? 'bg-green-400' : 'bg-gray-600'
                    }`}></div>
                  </div>
                  <div>
                    <p className="font-bold text-green-400">Concluído</p>
                    <p className="text-sm text-[#6ee7b7]">
                      {status.status === 'completed'
                        ? 'Seus dados foram deletados'
                        : `Previsto para ${new Date(status.expectedCompletionDate).toLocaleDateString('pt-BR')}`}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Seção de suporte */}
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-6">
              <h3 className="text-lg font-bold text-blue-400 mb-3">💬 Precisa de Ajuda?</h3>
              <p className="text-[#a7f3d0] mb-4">
                Se tiver dúvidas sobre sua solicitação, entre em contato conosco:
              </p>
              <a
                href={`mailto:privacidade@zapscript.me?subject=Status%20de%20Exclusão%20-%20${status.confirmationCode}`}
                className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
              >
                Enviar E-mail de Suporte
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
