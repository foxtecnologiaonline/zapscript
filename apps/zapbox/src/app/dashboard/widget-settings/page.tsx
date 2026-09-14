'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';

export default function WidgetSettingsPage() {
  const [publicKey, setPublicKey] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#25D366');
  const [greeting, setGreeting] = useState('');
  const [position, setPosition] = useState<'left' | 'right'>('right');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings').then((data) => {
      setPublicKey(data.publicKey);
      if (data.settings) {
        setPrimaryColor(data.settings.primaryColor);
        setGreeting(data.settings.greeting);
        setPosition(data.settings.position);
      }
    });
  }, []);

  async function save() {
    await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ primaryColor, greeting, position }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const snippet = `<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/widget.js" data-key="${publicKey}" data-color="${primaryColor}" data-position="${position}" async></script>`;

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <h1 className="text-xl font-bold">Widget</h1>

      <div className="bg-white border rounded-xl p-4 flex flex-col gap-3">
        <label className="text-sm font-medium">
          Cor principal
          <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="ml-3 align-middle" />
        </label>
        <label className="text-sm font-medium flex flex-col gap-1">
          Mensagem de saudação (enviada por WhatsApp ao iniciar uma conversa)
          <input
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-sm font-medium">
          Posição
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as 'left' | 'right')}
            className="ml-3 border rounded-lg px-2 py-1"
          >
            <option value="right">Direita</option>
            <option value="left">Esquerda</option>
          </select>
        </label>
        <button onClick={save} className="self-start bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
          {saved ? 'Salvo!' : 'Salvar'}
        </button>
      </div>

      <div className="bg-white border rounded-xl p-4">
        <h2 className="font-medium mb-2">Código para embutir no site</h2>
        <p className="text-sm text-gray-500 mb-2">Cole esta linha antes do <code>&lt;/body&gt;</code> do seu site.</p>
        <pre className="bg-gray-900 text-gray-100 text-xs rounded-lg p-3 overflow-x-auto">{snippet}</pre>
      </div>
    </div>
  );
}
