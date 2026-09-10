export const metadata = {
  title: 'ZapScript Campanhas — Playbook de Vendas',
  description: 'Pitch destruidor + 5 variações de guerrilha + roteiro B2B. Técnicas de venda que funcionam. Copie e comece hoje.',
};

export default function CampanhasVendas() {
  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
          --primary: #059669;
          --danger: #dc2626;
          --dark: #0f172a;
          --text: #1e293b;
          --text-light: #64748b;
          --bg: #f8fafc;
          --card: #ffffff;
        }

        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) {
            --dark: #0f172a;
            --text: #f1f5f9;
            --text-light: #cbd5e1;
            --bg: #0f172a;
            --card: #1e293b;
          }
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: var(--bg);
          color: var(--text);
          line-height: 1.6;
        }

        .container {
          max-width: 900px;
          margin: 0 auto;
          padding: 40px 20px;
        }

        header {
          text-align: center;
          margin-bottom: 50px;
          padding-bottom: 30px;
          border-bottom: 3px solid var(--primary);
        }

        h1 {
          font-size: 42px;
          font-weight: 900;
          margin-bottom: 8px;
          color: var(--dark);
        }

        .tagline {
          font-size: 18px;
          color: var(--danger);
          font-weight: 700;
          margin-bottom: 16px;
        }

        .subtitle {
          font-size: 14px;
          color: var(--text-light);
        }

        section {
          margin-bottom: 50px;
        }

        h2 {
          font-size: 28px;
          font-weight: 800;
          margin-bottom: 20px;
          color: var(--dark);
        }

        .alert {
          background: #fee2e2;
          border-left: 4px solid var(--danger);
          padding: 16px;
          margin-bottom: 20px;
          border-radius: 4px;
          color: #991b1b;
        }

        .alert strong {
          display: block;
          margin-bottom: 4px;
        }

        .pitch-box {
          background: var(--card);
          border: 2px solid var(--primary);
          padding: 20px;
          margin-bottom: 20px;
          border-radius: 6px;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.6;
          overflow-x: auto;
          white-space: pre-wrap;
        }

        .technique {
          background: var(--card);
          border-left: 4px solid var(--primary);
          padding: 20px;
          margin-bottom: 20px;
          border-radius: 4px;
        }

        .technique h3 {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 8px;
          color: var(--primary);
        }

        .technique p {
          color: var(--text-light);
          margin-bottom: 12px;
        }

        .technique .example {
          background: var(--bg);
          padding: 12px;
          border-radius: 4px;
          font-size: 12px;
          margin-top: 8px;
          color: var(--text);
        }

        ul {
          list-style: none;
          margin-bottom: 20px;
        }

        li {
          padding: 8px 0;
          padding-left: 24px;
          position: relative;
        }

        li:before {
          content: "▸";
          position: absolute;
          left: 0;
          color: var(--primary);
          font-weight: bold;
        }

        .cta {
          background: var(--danger);
          color: white;
          padding: 30px;
          border-radius: 6px;
          text-align: center;
          margin-top: 50px;
        }

        .cta h3 {
          font-size: 20px;
          margin-bottom: 12px;
        }

        .btn {
          display: inline-block;
          background: white;
          color: var(--danger);
          padding: 12px 24px;
          border-radius: 4px;
          font-weight: 700;
          text-decoration: none;
          margin-top: 16px;
          transition: all 0.2s;
        }

        .btn:hover {
          transform: scale(1.05);
        }

        .stat-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          margin-bottom: 30px;
        }

        .stat {
          text-align: center;
          padding: 20px;
          background: var(--card);
          border: 2px solid var(--primary);
          border-radius: 6px;
        }

        .stat-value {
          font-size: 32px;
          font-weight: 900;
          color: var(--primary);
        }

        .stat-label {
          font-size: 12px;
          color: var(--text-light);
          margin-top: 8px;
          font-weight: 600;
        }

        footer {
          text-align: center;
          padding-top: 30px;
          border-top: 1px solid #e2e8f0;
          color: var(--text-light);
          font-size: 12px;
        }

        @media (max-width: 600px) {
          h1 { font-size: 28px; }
          h2 { font-size: 20px; }
          .stat-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="container">
        <header>
          <div className="tagline">⚠️ SITUAÇÃO CRÍTICA</div>
          <h1>ZapScript Campanhas</h1>
          <p className="subtitle">Pitch destruidor + técnicas que fecham</p>
        </header>

        <section>
          <div className="alert">
            <strong>FATO:</strong> Meta banciu 5,1 MILHÕES de números em 6 meses por disparo não oficial. Seu prospect ESTÁ com medo agora. Esse é o momento.
          </div>

          <div className="stat-row">
            <div className="stat">
              <div className="stat-value">5M+</div>
              <div className="stat-label">banidos em 6 meses</div>
            </div>
            <div className="stat">
              <div className="stat-value">R$0</div>
              <div className="stat-label">taxa de setup (vs R$5-15k da concorrência)</div>
            </div>
            <div className="stat">
              <div className="stat-value">30 min</div>
              <div className="stat-label">até primeira campanha disparada</div>
            </div>
          </div>
        </section>

        <section>
          <h2>🎯 3 GATILHOS QUE VENDEM</h2>

          <div className="technique">
            <h3>1️⃣ URGÊNCIA — Pode ser amanhã</h3>
            <p><strong>"Seu número pode levar bloqueio HOJE. Depois não volta."</strong></p>
            <p>Não vende produto. Vende SEGURANÇA. A dor é AGORA. Use: "risco iminente", "pode ser amanhã", "enquanto tem tempo".</p>
            <div className="example">
              ❌ "Você pode usar API oficial pra disparar"<br/>
              ✅ "Seu número já foi ameaçado? Meta está banindo AGORA."
            </div>
          </div>

          <div className="technique">
            <h3>2️⃣ PROVA SOCIAL — Todos já migraram</h3>
            <p><strong>"Seus concorrentes já estão no canal oficial."</strong></p>
            <p>Mostre que não é experimental. Que OUTROS já fazem. Que a Lei EXIGE (LGPD). Que é OBRIGAÇÃO agora, não opção.</p>
            <div className="example">
              ✅ "Corretoras, clínicas e agências já migraram. É padrão agora — não é mais opção."
            </div>
          </div>

          <div className="technique">
            <h3>3️⃣ CONTRASTE — 10x mais barato</h3>
            <p><strong>"Zenvia cobra R$5-15k setup. Aqui: zero taxa, paga só o uso."</strong></p>
            <p>Não fala preço absoluto. Fala DIFERENÇA. Cliente não ouve "R$150", ouve "R$5.000 a menos + zero taxa".</p>
            <div className="example">
              ❌ "R$150 por 1.000 mensagens"<br/>
              ✅ "Zenvia cobra R$5-15k pra começar. Aqui você não paga setup — só as mensagens que dispara."
            </div>
          </div>
        </section>

        <section>
          <h2>🔥 PITCH DESTRUIDOR</h2>

          <div className="pitch-box">{`Oi [Nome],

Seu número de WhatsApp já levou bloqueio nos últimos 6 meses?

Pergunto porque a Meta banciu 5,1 MILHÕES de números — maioria por disparo fora da API oficial. Pode ser seu HOJE.

Se tá usando bot não-oficial, o risco não é "pode" — é QUANDO.

SOLUÇÃO:
→ Dispara HOJE pelo ZapScript Campanhas (conecta em 10 min via QR)
→ API oficial da Meta (zero risco novo)
→ 30 msgs grátis/mês
→ Depois R$150/1000 msgs (sem setup, sem contrato)

Seus concorrentes já estão lá. Você tá esperando o quê?

Entra aqui e dispara tua primeira campanha AGORA:
zapscript.me/wappcampanhas

[seu nome]`}</div>
        </section>

        <section>
          <h2>⚡ 5 VARIAÇÕES — GUERRILHA</h2>

          <div className="technique">
            <h3>1️⃣ Comentário em blog sobre banimento</h3>
            <div className="example">Meta apertou demais desde jan — 5M+ banidos. Testei ZapScript Campanhas, dispara pela API oficial aprovada, 30 msgs grátis/mês. Resolveu. Entra e começa: zapscript.me/wappcampanhas</div>
          </div>

          <div className="technique">
            <h3>2️⃣ Resposta em Reclame Aqui / Fórum / Grupo</h3>
            <div className="example">Passei por isso. Solução: migrar pra API oficial da Meta JÁ — ou é oficial ou o risco volta. ZapScript Campanhas: conecta em 10 min via QR. Entra agora: zapscript.me/wappcampanhas</div>
          </div>

          <div className="technique">
            <h3>3️⃣ YouTube — Comentário em vídeo</h3>
            <div className="example">ZapScript Campanhas dispara direto pela API oficial aprovada — sem esperar, sem risco, sem taxa. 30 msgs grátis pra testar. Começa agora: zapscript.me/wappcampanhas</div>
          </div>

          <div className="technique">
            <h3>4️⃣ Live chat — Curtíssimo</h3>
            <div className="example">bot banido? ZapScript Campanhas dispara pela API oficial, 30 msgs grátis. Entra já: zapscript.me/wappcampanhas</div>
          </div>

          <div className="technique">
            <h3>5️⃣ Grupo Telegram / Facebook — Tom de par</h3>
            <div className="example">Tava igual vcs com bot banido. Migrei pro canal oficial pelo ZapScript Campanhas — conecta via QR, dispara em 10 min. Entra agora: zapscript.me/wappcampanhas</div>
          </div>
        </section>

        <section>
          <h2>🎬 ROTEIRO B2B — 3 PASSOS</h2>

          <p><strong>DIA 0 — Dispara no mesmo dia</strong></p>
          <div className="pitch-box">{`Oi [Nome],

Seu número de WhatsApp já levou bloqueio nos últimos 6 meses?

A Meta banciu 5M+ números — pode ser seu HOJE. Sem aviso.

ZapScript Campanhas resolve isso:
• Conecta AGORA via QR (10 min e dispara)
• API oficial da Meta (zero risco)
• 30 msgs grátis/mês, depois R$150/1000 msgs

Seus concorrentes já estão lá.

Entra e dispara tua primeira campanha:
zapscript.me/wappcampanhas`}</div>

          <p style={{ marginTop: '20px' }}><strong>DIA 3 — Follow-up (ainda não respondeu)</strong></p>
          <div className="pitch-box">{`[Nome],

Rápido: ainda tá esperando? Seus concorrentes JÁ migraram pro canal oficial.

Meta está banindo HOJE. Enquanto você pensa, seu número pode levar bloqueio.

Entra e começa AGORA:
zapscript.me/wappcampanhas`}</div>

          <p style={{ marginTop: '20px' }}><strong>DIA 7 — Último toque (com prova social)</strong></p>
          <div className="pitch-box">{`[Nome],

Última msg: Zenvia cobra R$5-15k pra começar. Aqui: ZERO taxa.

Corretoras, clínicas e agências já estão lá disparando. Você ficando pra trás.

Entra AGORA e começa grátis:
zapscript.me/wappcampanhas`}</div>

          <p style={{ marginTop: '20px' }}><strong>QUANDO OUVE: "Já usamos bot, tá tudo certo"</strong></p>
          <div className="example">
            Tá — por enquanto. Mas risco é 100% REAL. Semana passada 5 clientes meus levaram bloqueio — tavam "tudo certo" também.

            Questão não é SE vai levar — é QUANDO vai levar.

            Meta não avisa. Um dia tá funcionando, próximo dia seu número some. Sem volta.

            Migra pro canal que Meta APROVA. Entra agora e dispara grátis:
            zapscript.me/wappcampanhas
          </div>
        </section>

        <section>
          <h2>📊 O QUE IMPORTA MEDIR</h2>

          <p><strong>Não é clique. É PRIMEIRA CAMPANHA DISPARADA.</strong></p>

          <ul>
            <li><strong>Cadastro</strong> = tráfego chegando (GA4: utm_source=guerrilha ou b2b)</li>
            <li><strong>Primeira campanha</strong> = ativação real (ele sentiu o produto funcionar)</li>
            <li><strong>Segunda compra</strong> = LTV positivo (aí você venceu)</li>
          </ul>

          <p style={{ marginTop: '20px' }}><strong>Regra:</strong> Se após 4 dias um canal não gera nenhuma primeira campanha disparada, MATA e realoca tempo pro vencedor.</p>
        </section>

        <section className="cta">
          <h3>ENTRA AGORA E DISPARA</h3>
          <p>Seus concorrentes já estão lá. Não fica pra trás.</p>
          <a href="https://zapscript.me/wappcampanhas" className="btn">→ Disparar Primeira Campanha AGORA</a>
        </section>
      </div>

      <footer>
        <p>ZapScript Campanhas © 2026 | Playbook de Vendas Otimizado</p>
      </footer>
    </>
  );
}
