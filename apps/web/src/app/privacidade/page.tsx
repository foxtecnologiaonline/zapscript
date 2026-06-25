import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidade — ZapScript',
  description: 'Política de Privacidade do ZapScript, em conformidade com a LGPD (Lei nº 13.709/2018).',
  robots: { index: true, follow: true },
};

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --brand: #10b981;
    --bg: #040b09;
    --surface: #0d1c19;
    --surface2: #132621;
    --border: rgba(16,185,129,0.10);
    --text: #d1fae5;
    --muted: rgba(16,185,129,0.45);
    --accent-bg: rgba(16,185,129,0.07);
    --warn-bg: rgba(255,180,0,0.06);
    --warn-border: rgba(255,180,0,0.2);
  }
  .legal-body { font-family: 'Georgia','Times New Roman',serif; background: var(--bg); color: var(--text); line-height: 1.85; font-size: 16px; min-height:100vh; }
  .legal-header { border-bottom: 1px solid var(--border); padding: 2rem 0; text-align: center; background: var(--surface); }
  .legal-logo { font-family: 'Courier New',monospace; font-size: 1.1rem; color: var(--brand); letter-spacing: .1em; text-transform: uppercase; margin-bottom: .5rem; }
  .legal-header h1 { font-size: 1.6rem; font-weight: normal; letter-spacing: -.02em; }
  .legal-header .meta { font-family: 'Courier New',monospace; font-size: .72rem; color: var(--muted); margin-top: .5rem; }
  .legal-main { max-width: 780px; margin: 0 auto; padding: 3rem 2rem 5rem; }
  .intro { background: var(--accent-bg); border-left: 3px solid var(--brand); padding: 1.25rem 1.5rem; border-radius: 0 6px 6px 0; margin-bottom: 2rem; font-size: .94rem; color: #a7f3d0; }
  .version-box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 3rem; font-family: 'Courier New',monospace; font-size: .75rem; color: var(--muted); }
  .version-box table { width: 100%; border-collapse: collapse; }
  .version-box td { padding: 3px 0; }
  .version-box td:first-child { color: rgba(16,185,129,.35); width: 140px; }
  .legal-h2 { font-family: 'Courier New',monospace; font-size: .73rem; text-transform: uppercase; letter-spacing: .15em; color: var(--brand); margin-top: 3rem; margin-bottom: 1rem; padding-bottom: .5rem; border-bottom: 1px solid var(--border); }
  .legal-p { margin-bottom: 1rem; color: #a7f3d0; }
  .legal-ul, .legal-ol { margin: .75rem 0 1rem 1.5rem; color: #a7f3d0; }
  .legal-ul li, .legal-ol li { margin-bottom: .4rem; }
  .legal-strong { color: var(--text); font-weight: 600; }
  .box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; margin: 1.5rem 0; }
  .box p { margin-bottom: .3rem; color: #a7f3d0; }
  .box p:last-child { margin-bottom: 0; }
  .warn-box { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 8px; padding: 1.1rem 1.4rem; margin: 1.5rem 0; }
  .warn-box p { color: #d4aa40; font-size: .9rem; margin-bottom: 0; }
  .legal-ref { font-family: 'Courier New',monospace; font-size: .7rem; color: rgba(16,185,129,.3); margin-left: .4rem; }
  .legal-a { color: var(--brand); text-decoration: none; }
  .legal-a:hover { text-decoration: underline; }
  .table-legal { width: 100%; border-collapse: collapse; font-size: .88rem; margin: 1rem 0; }
  .table-legal th { text-align: left; font-weight: 600; color: var(--text); font-size: .75rem; font-family: 'Courier New',monospace; text-transform: uppercase; letter-spacing: .07em; padding: .5rem .75rem; border-bottom: 1px solid var(--border); }
  .table-legal td { padding: .6rem .75rem; color: #a7f3d0; border-bottom: 1px solid rgba(16,185,129,.04); vertical-align: top; }
  .table-legal tr:last-child td { border-bottom: none; }
  .rights-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: .75rem; margin: 1.25rem 0; }
  .right-item { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: .875rem 1rem; }
  .right-title { font-weight: 600; color: var(--text); font-size: .88rem; margin-bottom: .25rem; }
  .right-desc { font-size: .82rem; color: rgba(16,185,129,.6); line-height: 1.5; }
  .right-law { font-family: 'Courier New',monospace; font-size: .65rem; color: var(--brand); margin-top: .3rem; }
  .legal-footer { text-align: center; padding: 2rem; border-top: 1px solid var(--border); font-family: 'Courier New',monospace; font-size: .7rem; color: var(--muted); }
  .sn { font-family: 'Courier New',monospace; font-size: .68rem; color: rgba(16,185,129,.3); margin-right: .4rem; }
  @media (max-width:600px) { .legal-main { padding: 2rem 1.25rem 4rem; } .rights-grid { grid-template-columns: 1fr; } }
`;

export default function PrivacidadePage() {
  return (
    <div className="legal-body">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <header className="legal-header">
        <div className="legal-logo">⚡ ZapScript</div>
        <h1>Política de Privacidade</h1>
        <p className="meta">Versão 2.0 &nbsp;·&nbsp; Vigente a partir de 01/06/2025 &nbsp;·&nbsp; Conforme Lei nº 13.709/2018 (LGPD)</p>
      </header>

      <main className="legal-main">

        <div className="intro">
          Esta Política descreve de forma clara e transparente como a <strong className="legal-strong">ZapScript</strong> coleta, utiliza, armazena, compartilha e protege seus dados pessoais. O tratamento é realizado com base legal definida, em estrita conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD) e demais normas aplicáveis. <strong className="legal-strong">O mero uso da plataforma não constitui consentimento</strong> — onde este for necessário, será coletado de forma específica, destacada e inequívoca.
        </div>

        <div className="version-box">
          <table>
            <tbody>
              <tr><td>Versão atual</td><td>2.0</td></tr>
              <tr><td>Vigência</td><td>01 de junho de 2025</td></tr>
              <tr><td>Substituiu</td><td>Versão 1.0 (mai/2025)</td></tr>
              <tr><td>Próxima revisão</td><td>01 de junho de 2026</td></tr>
              <tr><td>Contato DPO</td><td>privacidade@zapscript.me</td></tr>
            </tbody>
          </table>
        </div>

        {/* 01 */}
        <h2 className="legal-h2"><span className="sn">01 /</span> Identificação do Controlador <span className="legal-ref">Art. 5º VI e Art. 41 LGPD</span></h2>
        <div className="box">
          <p><strong className="legal-strong">Razão Social:</strong> FOX TECNOLOGIA LTDA &nbsp;·&nbsp; <strong className="legal-strong">CNPJ:</strong> 66.586.436/0001-12</p>
          <p><strong className="legal-strong">Endereço:</strong> Rua João Alfredo, 152 – Nossa Senhora da Abadia – Uberaba/MG – CEP 38025-300, Brasil</p>
          <p><strong className="legal-strong">Encarregado de Proteção de Dados (Encarregado/DPO):</strong> Roberto Frattari Tulio Silva</p>
          <p><strong className="legal-strong">E-mail do Encarregado:</strong> <a href="mailto:privacidade@zapscript.me" className="legal-a">privacidade@zapscript.me</a></p>
          <p><strong className="legal-strong">Site:</strong> <a href="https://www.zapscript.me" className="legal-a">zapscript.me</a> &nbsp;·&nbsp; <strong className="legal-strong">Atendimento:</strong> <a href="mailto:suporte@zapscript.me" className="legal-a">suporte@zapscript.me</a></p>
        </div>
        <p className="legal-p">A ZapScript é uma plataforma SaaS de conversão automatizada de áudios do WhatsApp, operada pela FOX TecnologIA, responsável pelo tratamento dos dados pessoais nos termos da LGPD.</p>

        {/* 02 */}
        <h2 className="legal-h2"><span className="sn">02 /</span> Base Legal por Finalidade <span className="legal-ref">Art. 7º e Art. 9º II LGPD</span></h2>
        <p className="legal-p">Todo tratamento de dados realizado pela ZapScript possui uma base legal específica:</p>
        <table className="table-legal">
          <thead><tr><th>Finalidade</th><th>Dados Envolvidos</th><th>Base Legal</th><th>Fundamento</th></tr></thead>
          <tbody>
            <tr><td>Criação e gerenciamento de conta</td><td>Nome, e-mail, senha (hash)</td><td>Execução de contrato</td><td>Art. 7º V LGPD</td></tr>
            <tr><td>Prestação do serviço de conversão</td><td>Áudios, conversões, metadados de uso</td><td>Execução de contrato</td><td>Art. 7º V LGPD</td></tr>
            <tr><td>Processamento de pagamentos</td><td>Dados de cobrança (via Asaas)</td><td>Execução de contrato</td><td>Art. 7º V LGPD</td></tr>
            <tr><td>Comunicações transacionais</td><td>E-mail, dados de conta</td><td>Legítimo interesse / Contrato</td><td>Art. 7º IX e V LGPD</td></tr>
            <tr><td>Segurança e prevenção de fraudes</td><td>IP, logs, dados técnicos</td><td>Legítimo interesse</td><td>Art. 7º IX LGPD</td></tr>
            <tr><td>Melhoria da plataforma (anonimizado)</td><td>Dados estatísticos anonimizados</td><td>Legítimo interesse</td><td>Art. 7º IX LGPD — dado anonimizado não é dado pessoal (Art. 12)</td></tr>
            <tr><td>Obrigações fiscais e contábeis</td><td>Dados de cobrança, NF</td><td>Obrigação legal</td><td>Art. 7º II LGPD c/c Lei 9.430/96</td></tr>
            <tr><td>Retenção de logs de acesso</td><td>IP, timestamp, logs</td><td>Obrigação legal</td><td>Art. 7º II LGPD c/c Art. 15 Marco Civil (Lei 12.965/14)</td></tr>
            <tr><td>Comunicações de marketing</td><td>E-mail, nome</td><td><strong className="legal-strong">Consentimento</strong></td><td>Art. 7º I LGPD — checkbox opcional e revogável</td></tr>
          </tbody>
        </table>
        <div className="warn-box">
          <p>⚠ O tratamento com base em <strong className="legal-strong">legítimo interesse</strong> é sempre proporcional, necessário e respeita os direitos fundamentais do titular. O titular pode opor-se a qualquer momento (Art. 18 II LGPD).</p>
        </div>

        {/* 03 */}
        <h2 className="legal-h2"><span className="sn">03 /</span> Dados Coletados <span className="legal-ref">Art. 6º III LGPD — Princípio da Necessidade</span></h2>
        <p className="legal-p">Coletamos apenas os dados estritamente necessários para cada finalidade declarada (princípio da necessidade):</p>
        <ul className="legal-ul">
          <li><strong className="legal-strong">Dados de cadastro:</strong> nome completo, e-mail e senha (armazenada exclusivamente em hash irreversível — nunca em texto puro).</li>
          <li><strong className="legal-strong">Dados de uso:</strong> data, hora e volume das conversões realizadas, funcionalidades utilizadas e frequência de acesso.</li>
          <li><strong className="legal-strong">Dados de pagamento:</strong> processados pelo Asaas (gateway de pagamento). A ZapScript <strong className="legal-strong">não armazena</strong> número de cartão, CVV ou dados bancários completos.</li>
          <li><strong className="legal-strong">Dados técnicos:</strong> endereço IP, tipo e versão de navegador, sistema operacional, identificadores de sessão e logs de acesso (obrigação legal — Marco Civil da Internet).</li>
          <li><strong className="legal-strong">Conteúdo de áudio:</strong> os áudios são processados exclusivamente para geração da conversão e <strong className="legal-strong">excluídos em até 24 horas</strong> após o processamento. Não são armazenados permanentemente, salvo se o usuário ativar essa função expressamente.</li>
          <li><strong className="legal-strong">Conversões geradas:</strong> armazenadas no perfil do usuário enquanto a conta estiver ativa, podendo ser excluídas a qualquer momento pelo próprio usuário.</li>
        </ul>
        <p className="legal-p">Não coletamos dados pessoais sensíveis (Art. 5º II LGPD) de forma intencional. Caso um áudio processado contenha tais informações, elas seguem o mesmo ciclo de vida do áudio e são descartadas após o processamento, sem registro separado.</p>

        {/* 04 */}
        <h2 className="legal-h2"><span className="sn">04 /</span> Compartilhamento de Dados <span className="legal-ref">Art. 7º §5º e Art. 26 LGPD</span></h2>
        <p className="legal-p">A ZapScript <strong className="legal-strong">não vende, aluga ou comercializa</strong> dados pessoais de seus usuários. O compartilhamento ocorre apenas nas seguintes situações:</p>
        <ul className="legal-ul">
          <li><strong className="legal-strong">Asaas</strong> (gateway de pagamento): para processamento de assinaturas, sujeito a seus próprios termos e obrigações legais de sigilo.</li>
          <li><strong className="legal-strong">Provedores de infraestrutura em nuvem</strong> (Supabase, Render, Upstash): para hospedagem, banco de dados e processamento. Contratados como operadores nos termos do Art. 37 LGPD.</li>
          <li><strong className="legal-strong">APIs de Speech-to-Text e IA</strong> (Groq/Whisper, Anthropic Claude): recebem os áudios exclusivamente para processamento técnico, sem direito de uso, retenção ou treinamento de modelos com o conteúdo do usuário.</li>
          <li><strong className="legal-strong">Ferramentas de análise e monitoramento:</strong> apenas dados técnicos anonimizados ou pseudonimizados.</li>
          <li><strong className="legal-strong">Autoridades e órgãos reguladores:</strong> quando exigido por lei, decisão judicial ou regulação administrativa.</li>
        </ul>

        {/* 05 */}
        <h2 className="legal-h2"><span className="sn">05 /</span> Transferência Internacional de Dados <span className="legal-ref">Art. 33 ao 36 LGPD</span></h2>
        <p className="legal-p">Alguns fornecedores técnicos operam fora do Brasil. A transferência internacional ocorre apenas nas hipóteses previstas no Art. 33 LGPD: países com proteção adequada reconhecida pela ANPD, mediante cláusulas contratuais específicas (SCCs), ou quando necessário para execução do contrato solicitado pelo titular.</p>

        {/* 06 */}
        <h2 className="legal-h2"><span className="sn">06 /</span> Retenção e Eliminação de Dados <span className="legal-ref">Art. 15 e 16 LGPD</span></h2>
        <table className="table-legal">
          <thead><tr><th>Tipo de Dado</th><th>Prazo de Retenção</th><th>Fundamento</th></tr></thead>
          <tbody>
            <tr><td>Áudios enviados</td><td>Até 24h após processamento</td><td>Princípio da necessidade — Art. 6º III LGPD</td></tr>
            <tr><td>Conversões geradas</td><td>Enquanto a conta estiver ativa + 90 dias após cancelamento</td><td>Execução de contrato — Art. 15 I LGPD</td></tr>
            <tr><td>Dados de cadastro</td><td>Enquanto ativo + 90 dias após cancelamento</td><td>Execução de contrato — Art. 15 I LGPD</td></tr>
            <tr><td>Logs de acesso (IP)</td><td>6 meses</td><td>Obrigação legal — Art. 15 Marco Civil (Lei 12.965/14)</td></tr>
            <tr><td>Dados de faturamento / NF</td><td>5 anos</td><td>Obrigação legal — Art. 173 CTN c/c Lei 9.430/96</td></tr>
            <tr><td>Registros de consentimento</td><td>5 anos após revogação</td><td>Ônus da prova — Art. 8º §2º LGPD</td></tr>
            <tr><td>Dados de comunicações marketing</td><td>Até revogação do consentimento + 30 dias para exclusão efetiva</td><td>Art. 8º §5º LGPD</td></tr>
          </tbody>
        </table>

        {/* 07 */}
        <h2 className="legal-h2"><span className="sn">07 /</span> Seus Direitos como Titular <span className="legal-ref">Art. 18 ao 20 LGPD</span></h2>
        <p className="legal-p">Você possui os seguintes direitos garantidos pela LGPD, exercíveis a qualquer momento:</p>
        <div className="rights-grid">
          {[
            { title: 'Acesso', desc: 'Confirmar a existência de tratamento e obter cópia dos seus dados.', law: 'Art. 18 II LGPD' },
            { title: 'Correção', desc: 'Corrigir dados incompletos, inexatos ou desatualizados.', law: 'Art. 18 III LGPD' },
            { title: 'Anonimização ou Eliminação', desc: 'Eliminar dados desnecessários, excessivos ou tratados em desconformidade.', law: 'Art. 18 IV LGPD' },
            { title: 'Portabilidade', desc: 'Receber seus dados em formato estruturado e interoperável.', law: 'Art. 18 V LGPD' },
            { title: 'Informação sobre Compartilhamento', desc: 'Saber com quais entidades seus dados foram compartilhados.', law: 'Art. 18 VII LGPD' },
            { title: 'Revogação do Consentimento', desc: 'Revogar consentimento a qualquer momento, sem ônus.', law: 'Art. 18 IX LGPD' },
            { title: 'Oposição', desc: 'Opor-se a tratamentos baseados em legítimo interesse.', law: 'Art. 18 II LGPD' },
            { title: 'Informação sobre Negativa', desc: 'Ser informado sobre as consequências de não fornecer consentimento.', law: 'Art. 18 VIII LGPD' },
          ].map(r => (
            <div key={r.title} className="right-item">
              <div className="right-title">{r.title}</div>
              <div className="right-desc">{r.desc}</div>
              <div className="right-law">{r.law}</div>
            </div>
          ))}
        </div>
        <div className="box">
          <p><strong className="legal-strong">Como exercer seus direitos:</strong></p>
          <p>📧 E-mail: <a href="mailto:privacidade@zapscript.me" className="legal-a">privacidade@zapscript.me</a> — Prazo de resposta: <strong className="legal-strong">15 dias corridos</strong> (Art. 18 §5º LGPD).</p>
          <p>🖥 Painel da conta: funcionalidades de acesso, correção e exclusão disponíveis em <a href="https://www.zapscript.me/dashboard" className="legal-a">zapscript.me/dashboard</a>.</p>
          <p>Em caso de insatisfação, você pode registrar reclamação junto à <strong className="legal-strong">ANPD</strong> em <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer" className="legal-a">gov.br/anpd</a>.</p>
        </div>

        {/* 08 */}
        <h2 className="legal-h2"><span className="sn">08 /</span> Segurança da Informação <span className="legal-ref">Art. 46 ao 51 LGPD</span></h2>
        <ul className="legal-ul">
          <li>Transmissão criptografada via TLS 1.2+ (HTTPS) em todas as comunicações;</li>
          <li>Armazenamento de dados em repouso com criptografia AES-256-GCM;</li>
          <li>Senhas armazenadas exclusivamente em hash com salting (bcrypt/argon2);</li>
          <li>Controle de acesso baseado em função (RBAC) com princípio do menor privilégio;</li>
          <li>Monitoramento contínuo de segurança e logs de auditoria interna;</li>
          <li>Revisões periódicas de segurança e testes de vulnerabilidade.</li>
        </ul>
        <p className="legal-p"><strong className="legal-strong">Incidentes:</strong> Em caso de incidente com risco relevante aos titulares, a ZapScript notificará a ANPD e os titulares afetados em prazo razoável, conforme Art. 48 LGPD.</p>

        {/* 09 */}
        <h2 className="legal-h2"><span className="sn">09 /</span> Cookies e Tecnologias de Rastreamento</h2>
        <table className="table-legal">
          <thead><tr><th>Tipo</th><th>Finalidade</th><th>Duração</th><th>Base Legal</th></tr></thead>
          <tbody>
            <tr><td>Cookies essenciais</td><td>Autenticação de sessão, segurança CSRF</td><td>Sessão</td><td>Legítimo interesse — Art. 7º IX LGPD</td></tr>
            <tr><td>Cookies de preferência</td><td>Configurações de idioma e interface</td><td>12 meses</td><td>Legítimo interesse — Art. 7º IX LGPD</td></tr>
            <tr><td>Cookies analíticos</td><td>Métricas de uso anonimizadas</td><td>13 meses</td><td>Consentimento — Art. 7º I LGPD</td></tr>
          </tbody>
        </table>

        {/* 10 */}
        <h2 className="legal-h2"><span className="sn">10 /</span> Menores de Idade <span className="legal-ref">Art. 14 LGPD</span></h2>
        <p className="legal-p">Os serviços da ZapScript são destinados exclusivamente a pessoas com <strong className="legal-strong">18 anos ou mais</strong>. Não coletamos conscientemente dados de crianças ou adolescentes. Caso identificado, procederemos com exclusão imediata, conforme Art. 14 LGPD.</p>

        {/* 11 */}
        <h2 className="legal-h2"><span className="sn">11 /</span> Alterações nesta Política <span className="legal-ref">Art. 8º §6º LGPD</span></h2>
        <p className="legal-p">Esta Política poderá ser atualizada periodicamente. Em caso de alterações materiais, notificaremos os usuários ativos por e-mail com antecedência mínima de <strong className="legal-strong">15 dias corridos</strong>.</p>

        {/* 12 */}
        <h2 className="legal-h2"><span className="sn">12 /</span> Encarregado de Proteção de Dados e Contatos <span className="legal-ref">Art. 41 LGPD</span></h2>
        <div className="box">
          <p><strong className="legal-strong">Encarregado de Proteção de Dados (DPO):</strong> Roberto Frattari Tulio Silva</p>
          <p><strong className="legal-strong">E-mail:</strong> <a href="mailto:privacidade@zapscript.me" className="legal-a">privacidade@zapscript.me</a></p>
          <p><strong className="legal-strong">Prazo de resposta:</strong> até 15 dias corridos (Art. 18 §5º LGPD)</p>
          <p style={{ marginTop: '.75rem' }}><strong className="legal-strong">ANPD:</strong> <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer" className="legal-a">gov.br/anpd</a></p>
        </div>

      </main>

      <footer className="legal-footer">
        © 2025 ZapScript · FOX TecnologIA &nbsp;·&nbsp; Todos os direitos reservados &nbsp;·&nbsp;
        <a href="/termos" className="legal-a">Termos de Serviço</a> &nbsp;·&nbsp;
        <a href="/contrato" className="legal-a">Contrato de Prestação</a> &nbsp;·&nbsp;
        <a href="/privacidade" className="legal-a">Política de Privacidade</a>
      </footer>
    </div>
  );
}
