export const metadata = {
  title: 'ZapScript Campanhas — Playbook de Vendas',
  description: 'Técnicas de vendas diretas: urgência, gatilhos psicológicos, pitches prontos pra copiar e guerrilha comprovada.',
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
          <div className="tagline">⚠️ A REALIDADE DO MERCADO</div>
          <h1>ZapScript Campanhas</h1>
          <p className="subtitle">Playbook de Vendas — Técnicas que funcionam</p>
        </header>

        <section>
          <div className="alert">
            <strong>FATO:</strong> A Meta banciu mais de 5,1 milhões de números em junho de 2026 por disparo não oficial. Seu cliente está com medo de perder o número. Essa é a porta de entrada.
          </div>

          <div className="stat-row">
            <div className="stat">
              <div className="stat-value">5M+</div>
              <div className="stat-label">números banidos em 6 meses</div>
            </div>
            <div className="stat">
              <div className="stat-value">R$0</div>
              <div className="stat-label">taxa de adesão (diferente de Zenvia/Take Blip que cobram R$5-15k)</div>
            </div>
            <div className="stat">
              <div className="stat-value">30 min</div>
              <div className="stat-label">tempo até primeira campanha disparada</div>
            </div>
          </div>
        </section>

        <section>
          <h2>🎯 OS 3 GATILHOS PSICOLÓGICOS QUE VENDEM</h2>

          <div className="technique">
            <h3>1️⃣ URGÊNCIA + ESCASSEZ</h3>
            <p><strong>"Seu número pode ser banido hoje. Depois não tem volta."</strong></p>
            <p>O cliente não está comprando um produto. Está comprando SEGURANÇA. A dor é AGORA. Não amanhã. Use linguagem de crise: "risco iminente", "banimento em processo", "enquanto tem tempo".</p>
            <div className="example">
              ❌ "Você pode usar nossa API oficial pra disparar mensagens"
              <br />✅ "Seu número já foi ameaçado? A Meta está banindo AGORA. Seus concorrentes já estão migrando pro canal oficial."
            </div>
          </div>

          <div className="technique">
            <h3>2️⃣ PROVA SOCIAL + AUTORIDADE</h3>
            <p><strong>"Outros já resolveram. Você é o único ainda em risco."</strong></p>
            <p>Mostre que isso NÃO é experimental. Que os maiores nomes já fazem. Que a Meta EXIGE. Que a Lei EXIGE (LGPD, opt-out automático).</p>
            <div className="example">
              ✅ "Corretoras, clínicas e agências já estão usando a API oficial. É o padrão agora — não é mais opção, é obrigação."
            </div>
          </div>

          <div className="technique">
            <h3>3️⃣ CONTRASTE DE PREÇO</h3>
            <p><strong>"Zenvia cobra R$5-15k de setup + contrato mínimo. ZapScript: zero taxa, paga quando usar, via Pix."</strong></p>
            <p>Não fale de preço absoluto. Fale de DIFERENÇA. O cliente não ouve "R$150", ouve "R$5.000 a menos do que a concorrência + zero taxa".</p>
            <div className="example">
              ❌ "Campanhas saem R$150 por 1.000 mensagens"
              <br />✅ "Zenvia cobra R$5-15k pra começar. Aqui você não paga NADA pra conectar — só as mensagens que realmente dispara. Sem setup, sem contrato."
            </div>
          </div>
        </section>

        <section>
          <h2>🔥 PITCH DESTRUIDOR (copia inteira)</h2>

          <div className="pitch-box">{`Oi [Nome],

Sou [seu nome] da ZapScript. Pergunta rápida: seu número [empresa] já levou bloqueio ou aviso recente no WhatsApp?

Pergunto porque a Meta apertou MUITO desde janeiro — 5,1 MILHÕES de números foram banidos só em junho. A maioria por disparo fora da API oficial.

Se você usa bot ou automação não-oficial (QR code de terceiro, clone), o risco é REAL e pode acontecer amanhã. Não é "pode", é QUANDO.

Montamos o ZapScript Campanhas exatamente pra quem tá nessa situação:

→ Conecta o seu número via QR Code (sem esperar aprovação)
→ Dispara HOJE MESMO pro seu próprio WhatsApp, já compliant
→ Depois migra pro canal oficial da Meta sem restrição
→ 30 msgs grátis por mês pra testar sem custo

Só isso. Sem R$15k de setup, sem contrato, sem enrolação.

O preço? R$150/1000 msgs ou R$699/mês ilimitado. Paga via Pix na hora.

Faz sentido uma conversa de 10 min pra eu mostrar como sai no seu caso específico? Sem obrigação, é só pra você ver que é simples mesmo.

Abraço`}</div>

          <p><strong>Por que funciona:</strong></p>
          <ul>
            <li>Começa com PERGUNTA (não é venda, é conversa)</li>
            <li>Cita NÚMERO REAL de banimento (prova social)</li>
            <li>Explica o RISCO DELE especificamente</li>
            <li>Oferece DOIS caminhos (hoje + depois)</li>
            <li>Compara com concorrente (CONTRASTE)</li>
            <li>Fecha com PERMISSÃO (não é forcado)</li>
          </ul>
        </section>

        <section>
          <h2>⚡ 5 VARIAÇÕES PARA A GUERRILHA (comentários, DMs, grupos)</h2>

          <div className="technique">
            <h3>Variação 1: Blog sobre banimento</h3>
            <div className="example">Isso tá batendo certo com jan/2026 — Meta apertou pra caramba. Testei o ZapScript Campanhas (tem 30 msgs grátis) que dispara pela API oficial aprovada. Resolveu meu caso e é bem rápido de conectar. [zapscript.me/campanhas]</div>
          </div>

          <div className="technique">
            <h3>Variação 2: Resposta a reclamação (Reclame Aqui)</h3>
            <div className="example">Passei exatamente por isso. Solução: migrar pra API oficial da Meta. Sem API oficial = risco volta. Achei o ZapScript (zapscript.me/campanhas) que conecta fácil e tem cota grátis. Pode valer.</div>
          </div>

          <div className="technique">
            <h3>Variação 3: YouTube comment</h3>
            <div className="example">Queria saber se o canal cobre alternativas oficiais agora. Existe o ZapScript Campanhas que dispara direto pela API da Meta — já sai aprovado. Compartilho em caso alguém aqui tá na mesma situação: zapscript.me/campanhas</div>
          </div>

          <div className="technique">
            <h3>Variação 4: Live chat</h3>
            <div className="example">pra quem teve bot banido — tentei ZapScript Campanhas, dispara pela API da Meta, tem 30 msgs grátis — zapscript.me/campanhas</div>
          </div>

          <div className="technique">
            <h3>Variação 5: Grupo Telegram/Facebook</h3>
            <div className="example">Vi post aqui sobre bot banido — rolava o mesmo comigo até jan. Resolvi indo pro canal oficial via ZapScript (zapscript.me/campanhas). Tem QR Code fácil, começa já. Compartilhando em caso ajude alguém.</div>
          </div>
        </section>

        <section>
          <h2>🎬 O ROTEIRO DO FECHAMENTO (B2B direto)</h2>

          <p><strong>PASSO 1 — Primeira mensagem (conexão via LinkedIn ou WhatsApp):</strong></p>
          <div className="pitch-box">{`Oi [Nome], tudo ok?

Sou [você] da ZapScript — fiz uma pergunta rápida pra [empresa]:

Seu número de WhatsApp já levou bloqueio nos últimos 6 meses?

Pergunto porque a Meta intensificou a repressão contra disparo fora da API oficial. 5 milhões de números foram banidos só em junho.

A gente desenvolveu uma solução pra quem tá nessa situação — conecta hoje via QR e dispara compliant.

Faz sentido eu enviar um resumo de 2 min de como isso sairia pra vocês?`}</div>

          <p style={{ marginTop: '20px' }}><strong>PASSO 2 — Depois de "sim" (ou no follow-up):</strong></p>
          <div className="pitch-box">{`Perfeito! Deixa eu explicar rápido:

HOJE: conectam o número de vocês via QR Code (tipo WhatsApp Web, mas pra disparar). PRONTO. Já dispara de verdade, sem esperar nada.

DEPOIS: migramos pra API oficial da Meta (com templates aprovados, escala sem limite, entrega rastreada).

Preço:
- 30 msgs grátis/mês (pra testar)
- R$150 por 1.000 msgs (90 dias)
- R$699/mês ilimitado
- Sem taxa de setup, sem contrato mínimo

Diferente de Zenvia/Take Blip que cobram R$5-15k só pra começar.

Todos os números ficam com opt-out automático (LGPD). Quem responde "SAIR" é excluído na hora — sem trabalho manual.

Volume de vocês é quanto por mês? Com isso dou um número exato de quanto sairia.`}</div>

          <p style={{ marginTop: '20px' }}><strong>PASSO 3 — Objeção: "já usamos bot, tá tudo certo":</strong></p>
          <div className="example">"Tá — por enquanto. Mas o risco é REAL. Semana passada levaram bloqueio 5 clientes nossos que estavam "tudo certo" também. A Meta não avisa antes. É de um dia pro outro. A questão não é SE vai levar, é QUANDO. Prefere contar com sorte ou migrar pra canal que a própria Meta aprova? A gente oferece transição suave — testam grátis, depois convertem."</div>
        </section>

        <section>
          <h2>📊 MÉTRICA QUE IMPORTA</h2>

          <p>Não mede clic. Mede <strong>primeira campanha disparada</strong>.</p>

          <ul>
            <li><strong>Cadastro = tráfego</strong> (vai pra GA4 com utm_source=guerrilha ou utm_source=b2b)</li>
            <li><strong>Primeira campanha = ativação</strong> (é quando ele sente o produto é real)</li>
            <li><strong>Segunda compra = conversão</strong> (aí você sabe que o LTV é positivo)</li>
          </ul>

          <p style={{ marginTop: '20px' }}>Se após 4 dias um canal não gerar nenhuma primeira campanha, mata e realoca tempo pro vencedor.</p>
        </section>

        <section className="cta">
          <h3>COMECE HOJE</h3>
          <p>Comenta nos 6 blogs listados na execução + dispara 3 DMs B2B. Leva 40 minutos, zero custo.</p>
          <a href="https://zapscript.me/campanhas" className="btn">→ Criar Primeira Campanha</a>
        </section>
      </div>

      <footer>
        <p>ZapScript Campanhas © 2026 | Playbook de Vendas</p>
      </footer>
    </>
  );
}
