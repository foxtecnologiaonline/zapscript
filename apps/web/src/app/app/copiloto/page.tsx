'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

/**
 * Tela mínima do Copiloto — só o que a Função 2 exige pra funcionar: escolher
 * quais grupos entram no resumo diário (opt-in explícito, nunca todos por
 * padrão). A Função 1 (mensagens individuais) não tem tela nenhuma no MVP —
 * chega e se resolve inteira no WhatsApp. Histórico/busca completos (painel
 * de verdade) ficam pra V1; isso aqui é só a peça que não dá pra fazer sem UI.
 */

interface WNumber {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  status: string;
}

interface CopilotoGroupRow {
  groupJid: string;
  name: string;
  active: boolean;
}

export default function CopilotoPage() {
  const [numbers, setNumbers] = useState<WNumber[]>([]);
  const [numberId, setNumberId] = useState('');
  const [groups, setGroups] = useState<CopilotoGroupRow[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notEntitled, setNotEntitled] = useState(false);
  const [busyJid, setBusyJid] = useState<string | null>(null);

  useEffect(() => {
    api.get<WNumber[]>('/numbers')
      .then((nums) => {
        const connected = nums.filter((n) => n.status === 'connected');
        setNumbers(connected);
        if (connected.length > 0) setNumberId(connected[0].id);
      })
      .catch((e: any) => setError(e?.message || 'Não foi possível carregar seus números.'))
      .finally(() => setLoadingNumbers(false));
  }, []);

  const loadGroups = useCallback((id: string) => {
    if (!id) return;
    setLoadingGroups(true);
    setError(null);
    api.get<{ groups: CopilotoGroupRow[] }>(`/copiloto/numbers/${id}/groups`)
      .then((res) => setGroups(res.groups))
      .catch((e: any) => {
        if (e?.moduleRequired) setNotEntitled(true);
        else setError(e?.message || 'Não foi possível carregar os grupos.');
      })
      .finally(() => setLoadingGroups(false));
  }, []);

  useEffect(() => { if (numberId) loadGroups(numberId); }, [numberId, loadGroups]);

  async function toggle(group: CopilotoGroupRow) {
    setBusyJid(group.groupJid);
    const nextActive = !group.active;
    setGroups((gs) => gs.map((g) => (g.groupJid === group.groupJid ? { ...g, active: nextActive } : g)));
    try {
      await api.post(`/copiloto/numbers/${numberId}/groups`, {
        groupJid: group.groupJid,
        name:     group.name,
        active:   nextActive,
      });
    } catch (e: any) {
      // reverte em caso de erro
      setGroups((gs) => gs.map((g) => (g.groupJid === group.groupJid ? { ...g, active: !nextActive } : g)));
      setError(e?.message || 'Não foi possível atualizar o grupo.');
    } finally {
      setBusyJid(null);
    }
  }

  if (loadingNumbers) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="text-neutral-500">Carregando...</div>
      </main>
    );
  }

  if (notEntitled) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-5 py-10">
        <div className="max-w-md w-full rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <div className="text-4xl mb-4">🧭</div>
          <h1 className="text-xl font-bold mb-2">Copiloto</h1>
          <p className="text-neutral-400 mb-6">
            Resumo de mensagens e sugestão de resposta, direto no seu WhatsApp — incluso nos planos Profissional e Empresas.
          </p>
          <Link href="/dashboard/plano" className="inline-block rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500">
            Ver planos
          </Link>
          <div className="mt-4">
            <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-300">← Voltar aos módulos</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900/60 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/app" className="text-neutral-500 hover:text-neutral-300 text-sm">← Módulos</Link>
          <h1 className="text-lg font-bold flex items-center gap-2">🧭 Copiloto</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 mb-6 text-sm text-neutral-400">
          Mensagens individuais e compromissos você já recebe direto no seu WhatsApp,
          no chat <strong className="text-neutral-200">&ldquo;Mensagens para você mesmo&rdquo;</strong> — nada pra
          configurar aqui. Grupos são diferentes: só entram no resumo diário os que
          você ligar abaixo.
        </div>

        {numbers.length > 1 && (
          <div className="mb-4">
            <label className="block text-xs text-neutral-500 mb-1">Número</label>
            <select
              value={numberId} onChange={(e) => setNumberId(e.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
            >
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>{n.displayName || n.phoneNumber || n.id}</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</div>
        )}

        <h2 className="text-sm font-bold text-neutral-300 mb-3">Grupos ({groups.filter((g) => g.active).length} ativo{groups.filter((g) => g.active).length !== 1 ? 's' : ''})</h2>

        {loadingGroups ? (
          <div className="text-sm text-neutral-600 text-center py-6 rounded-xl border border-neutral-800">Carregando grupos...</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-neutral-600 text-center py-6 rounded-xl border border-neutral-800">Nenhum grupo encontrado nesse número.</div>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <label
                key={g.groupJid}
                className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={g.active}
                  disabled={busyJid === g.groupJid}
                  onChange={() => toggle(g)}
                />
                <span className="text-sm flex-1 min-w-0 truncate">{g.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
