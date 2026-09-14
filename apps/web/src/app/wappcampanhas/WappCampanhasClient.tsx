'use client';

import { useState } from 'react';

export default function WappCampanhas() {
  const [activeTab, setActiveTab] = useState(0);
  const [messageText, setMessageText] = useState('Oi {{nome}}, temos uma promoção especial! 🎁\n\nDesconto de 30% em tudo — só hoje.\n\n👉 Clique: zapscript.me/promo');
  const [contacts, setContacts] = useState([
    { phone: '11987654321', name: 'Maria Silva' },
    { phone: '11912345678', name: 'João Santos' },
    { phone: '11998765432', name: 'Ana Costa' }
  ]);

  const previewMessage = messageText.replace(/\{\{\s*nome\s*\}\}/gi, 'Maria');

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const csv = event.target?.result as string;
        const lines = csv.split('\n').filter(line => line.trim());
        const newContacts: typeof contacts = [];

        lines.forEach(line => {
          const parts = line.split(',').map(p => p.trim()).filter(Boolean);
          if (parts.length >= 1) {
            newContacts.push({
              phone: parts[0],
              name: parts[1] || ''
            });
          }
        });

        if (newContacts.length > 0) {
          setContacts(newContacts);
        }
      } catch (err) {
        console.error('Erro ao processar arquivo:', err);
      }
    };
    reader.readAsText(file);
  };

  const copyContacts = () => {
    const text = contacts.map(c => c.name ? `${c.phone}, ${c.name}` : c.phone).join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a' }}>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
          --primary: #059669;
          --text: #0f172a;
          --text-light: #475569;
          --border: #e2e8f0;
          --bg: #f8fafc;
          --card: #ffffff;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: var(--bg);
          color: var(--text);
          line-height: 1.5;
        }

        .container {
          max-width: 1000px;
          margin: 0 auto;
          padding: 20px;
        }

        header {
          padding: 30px 0;
          border-bottom: 1px solid var(--border);
          margin-bottom: 40px;
        }

        .logo {
          font-size: 20px;
          font-weight: 700;
          color: var(--primary);
        }

        .hero {
          text-align: center;
          margin-bottom: 50px;
        }

        .hero h1 {
          font-size: 32px;
          font-weight: 700;
          margin-bottom: 12px;
          color: var(--text);
        }

        .hero p {
          font-size: 16px;
          color: var(--text-light);
          margin-bottom: 30px;
        }

        .tabs {
          display: flex;
          gap: 10px;
          margin-bottom: 30px;
          border-bottom: 1px solid var(--border);
        }

        .tab-btn {
          padding: 12px 20px;
          border: none;
          background: transparent;
          color: var(--text-light);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border-bottom: 3px solid transparent;
          transition: all 0.2s;
        }

        .tab-btn:hover {
          color: var(--text);
        }

        .tab-btn.active {
          color: var(--primary);
          border-bottom-color: var(--primary);
        }

        .tab-content {
          display: none;
          animation: fadeIn 0.2s;
        }

        .tab-content.active {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          align-items: start;
        }

        @media (max-width: 768px) {
          .tab-content.active {
            grid-template-columns: 1fr;
          }
        }

        @keyframes fadeIn {
          from { opacity: 0; } to { opacity: 1; }
        }

        .content-text h2 {
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 16px;
        }

        .content-text p {
          color: var(--text-light);
          margin-bottom: 20px;
          line-height: 1.6;
        }

        .features {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .feature {
          display: flex;
          gap: 12px;
          font-size: 14px;
          color: var(--text-light);
        }

        .mockup {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .mockup-header {
          background: var(--primary);
          color: white;
          padding: 12px 16px;
          font-size: 12px;
          font-weight: 600;
        }

        .mockup-body {
          padding: 20px;
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-light);
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        input, textarea {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-family: inherit;
          font-size: 13px;
          background: var(--bg);
          color: var(--text);
        }

        textarea {
          resize: vertical;
          min-height: 80px;
        }

        input:focus, textarea:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 2px rgba(5, 150, 105, 0.1);
        }

        .whatsapp-preview {
          background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
          border-left: 4px solid #25d366;
          border-radius: 6px;
          padding: 12px;
          margin-top: 12px;
          font-size: 13px;
        }

        .whatsapp-bubble {
          background: #d9fdd3;
          color: #111b21;
          padding: 10px 12px;
          border-radius: 8px;
          word-break: break-word;
          line-height: 1.4;
          margin-bottom: 4px;
          white-space: pre-wrap;
        }

        .whatsapp-time {
          font-size: 11px;
          color: #65676b;
          text-align: right;
        }

        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 16px;
          margin-bottom: 40px;
        }

        .stat {
          text-align: center;
          padding: 20px;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 8px;
        }

        .stat-value {
          font-size: 28px;
          font-weight: 700;
          color: var(--primary);
        }

        .stat-label {
          font-size: 12px;
          color: var(--text-light);
          margin-top: 4px;
        }

        .cta {
          text-align: center;
          padding: 30px;
          background: var(--primary);
          color: white;
          border-radius: 8px;
          margin-top: 50px;
        }

        .cta h2 {
          font-size: 24px;
          margin-bottom: 12px;
        }

        .cta p {
          margin-bottom: 20px;
          opacity: 0.9;
        }

        .btn {
          display: inline-block;
          padding: 12px 24px;
          background: white;
          color: var(--primary);
          border: none;
          border-radius: 6px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
          text-decoration: none;
        }

        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .btn-secondary {
          display: inline-block;
          padding: 8px 12px;
          background: var(--border);
          color: var(--text);
          border: none;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          width: 100%;
          margin-top: 12px;
        }

        .btn-secondary:hover {
          background: var(--primary);
          color: white;
        }

        .contacts-list {
          margin-top: 16px;
          max-height: 200px;
          overflow-y: auto;
          border: 1px solid var(--border);
          border-radius: 6px;
        }

        .contact-item {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          font-size: 12px;
        }

        .contact-item:last-child {
          border-bottom: none;
        }

        .contact-phone {
          font-weight: 600;
          color: var(--text);
        }

        .contact-name {
          color: var(--text-light);
          font-size: 11px;
        }

        .upload-info {
          padding: 12px;
          background: var(--bg);
          border-radius: 6px;
          font-size: 12px;
          color: var(--text-light);
          margin-bottom: 12px;
        }

        .success-msg {
          padding: 12px;
          background: #d1fae5;
          color: #059669;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 12px;
          display: none;
        }

        .success-msg.show {
          display: block;
        }

        footer {
          text-align: center;
          padding: 30px 0;
          color: var(--text-light);
          font-size: 12px;
          border-top: 1px solid var(--border);
          margin-top: 50px;
        }
      `}</style>

      <header>
        <div className="container">
          <div className="logo">🚀 ZapScript Campanhas</div>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <h1>Crie campanhas em 3 passos</h1>
          <p>Rápido, fácil e totalmente compliant. Personalize a mensagem abaixo e veja o preview em tempo real.</p>
        </section>

        <div className="stats">
          <div className="stat">
            <div className="stat-value">5</div>
            <div className="stat-label">minutos</div>
          </div>
          <div className="stat">
            <div className="stat-value">∞</div>
            <div className="stat-label">campanhas</div>
          </div>
          <div className="stat">
            <div className="stat-value">0</div>
            <div className="stat-label">CSVs</div>
          </div>
        </div>

        <div className="tabs">
          {['1️⃣ Mensagem', '2️⃣ Números', '3️⃣ Enviar'].map((label, i) => (
            <button
              key={i}
              className={`tab-btn ${activeTab === i ? 'active' : ''}`}
              onClick={() => setActiveTab(i)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab 1: Mensagem */}
        <div className={`tab-content ${activeTab === 0 ? 'active' : ''}`}>
          <div className="content-text">
            <h2>Escreva a mensagem</h2>
            <p>Personalize com variáveis. Use <code>{'{{nome}}'}</code> para o nome do contato aparecer na mensagem.</p>
            <div className="features">
              <div className="feature">
                <div>✓</div>
                <div>Preview em tempo real</div>
              </div>
              <div className="feature">
                <div>✓</div>
                <div>Teste A/B (2 versões)</div>
              </div>
              <div className="feature">
                <div>✓</div>
                <div>Até 4.096 caracteres</div>
              </div>
            </div>
          </div>

          <div className="mockup">
            <div className="mockup-header">📝 Mensagem</div>
            <div className="mockup-body">
              <div className="form-group">
                <label className="form-label">Nome da campanha</label>
                <input type="text" value="Black Friday 2026" readOnly />
              </div>
              <div className="form-group">
                <label className="form-label">Sua mensagem</label>
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Oi {{nome}}, temos uma promoção pra você..."
                />
              </div>

              <div className="whatsapp-preview">
                <div className="whatsapp-bubble">{previewMessage}</div>
                <div className="whatsapp-time">14:32 ✓✓</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab 2: Números */}
        <div className={`tab-content ${activeTab === 1 ? 'active' : ''}`}>
          <div className="content-text">
            <h2>Adicione os números</h2>
            <p>Cole números, importe um CSV ou reutilize uma lista anterior. Sem exportações desnecessárias.</p>
            <div className="features">
              <div className="feature">
                <div>✓</div>
                <div>Colar 1 por linha (com ou sem nome)</div>
              </div>
              <div className="feature">
                <div>✓</div>
                <div>Importar CSV (telefone + nome)</div>
              </div>
              <div className="feature">
                <div>✓</div>
                <div>Reutilizar listas salvas</div>
              </div>
              <div className="feature">
                <div>✓</div>
                <div>Deduplicação automática</div>
              </div>
            </div>
          </div>

          <div className="mockup">
            <div className="mockup-header">📱 Números</div>
            <div className="mockup-body">
              <div className="upload-info">
                📄 Formato: CSV com coluna 1 = telefone, coluna 2 = nome (opcional)
              </div>

              <div className="form-group">
                <label className="form-label">Importar arquivo CSV</label>
                <input type="file" accept=".csv,text/csv" onChange={handleCSVUpload} />
              </div>

              <div className="form-group">
                <label className="form-label">Ou cole os números</label>
                <textarea
                  readOnly
                  value={contacts.map(c => c.name ? `${c.phone}, ${c.name}` : c.phone).join('\n')}
                  style={{ minHeight: '100px' }}
                />
              </div>

              <div style={{ marginTop: '12px', padding: '12px', background: '#d1fae5', borderRadius: '6px', fontSize: '12px', color: '#059669', fontWeight: '600' }}>
                ✓ {contacts.length} números adicionados
              </div>

              <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '12px' }}>
                <div style={{ color: 'var(--text-light)', fontWeight: '600', marginBottom: '8px' }}>NÚMEROS IMPORTADOS</div>
                <div className="contacts-list">
                  {contacts.slice(0, 50).map((contact, idx) => (
                    <div key={idx} className="contact-item">
                      <div className="contact-phone">{contact.phone}</div>
                      <div className="contact-name">{contact.name || '(sem nome)'}</div>
                    </div>
                  ))}
                  {contacts.length > 50 && (
                    <div className="contact-item" style={{ fontSize: '11px', color: 'var(--text-light)', fontWeight: '600' }}>
                      ... +{contacts.length - 50} mais
                    </div>
                  )}
                </div>
              </div>

              <button className="btn-secondary" onClick={copyContacts}>
                📋 Copiar para colar
              </button>
            </div>
          </div>
        </div>

        {/* Tab 3: Enviar */}
        <div className={`tab-content ${activeTab === 2 ? 'active' : ''}`}>
          <div className="content-text">
            <h2>Envie ou agende</h2>
            <p>Dispare imediatamente ou escolha uma data/hora. Acompanhe entrega e engajamento em tempo real.</p>
            <div className="features">
              <div className="feature">
                <div>✓</div>
                <div>Envio imediato com 1 clique</div>
              </div>
              <div className="feature">
                <div>✓</div>
                <div>Agende para data/hora específica</div>
              </div>
              <div className="feature">
                <div>✓</div>
                <div>Pause ou retome a qualquer hora</div>
              </div>
              <div className="feature">
                <div>✓</div>
                <div>Métricas ao vivo (entregues, lidos)</div>
              </div>
            </div>
          </div>

          <div className="mockup">
            <div className="mockup-header">🚀 Enviar</div>
            <div className="mockup-body">
              <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-light)', marginBottom: '6px' }}>CAMPANHA</div>
                <div style={{ fontSize: '16px', fontWeight: '600' }}>Black Friday 2026</div>
              </div>

              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--primary)' }}>{contacts.length}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-light)' }}>contatos</div>
              </div>

              <div className="form-group">
                <button style={{ width: '100%', padding: '12px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', marginBottom: '8px' }}>
                  ▶ Enviar agora
                </button>
                <button style={{ width: '100%', padding: '12px', background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}>
                  🗓️ Agendar
                </button>
              </div>
            </div>
          </div>
        </div>

        <section className="cta">
          <h2>Pronto para começar?</h2>
          <p>Crie sua primeira campanha e veja como é fácil</p>
          <a href="https://zapscript.me" className="btn">Acessar ZapScript →</a>
        </section>
      </main>

      <footer>
        <p>ZapScript.me Campanhas - Disparo de mensagens Multicanal</p>
      </footer>
    </div>
  );
}
