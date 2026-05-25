import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contrato de Prestação de Serviços — ZapScript',
  description: 'Contrato de Prestação de Serviços de Tecnologia da plataforma ZapScript. Versão 2.0, vigente a partir de 01/06/2025.',
};

const css = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --brand: #10b981; --bg: #0d0d0d; --surface: #161616; --surface2: #1c1c1c;
  --border: rgba(255,255,255,0.08); --text: #f0f0f0; --muted: #777;
  --accent-bg: rgba(16,185,129,0.07);
}
body { font-family: 'Georgia','Times New Roman',serif; background: var(--bg); color: var(--text); line-height: 1.85; font-size: 16px; }
header { border-bottom: 1px solid var(--border); padding: 2rem 0; text-align: center; background: var(--surface); }
.logo { font-family: 'Courier New',monospace; font-size: 1.1rem; color: var(--brand); letter-spacing: .1em; text-transform: uppercase; margin-bottom: .5rem; }
header h1 { font-size: 1.6rem; font-weight: normal; letter-spacing: -.02em; }
header .meta { font-family: 'Courier New',monospace; font-size: .72rem; color: var(--muted); margin-top: .5rem; }
main { max-width: 780px; margin: 0 auto; padding: 3rem 2rem 5rem; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2.5rem; }
.party-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem 1.4rem; }
.party-label { font-family: 'Courier New',monospace; font-size: .68rem; text-transform: uppercase; letter-spacing: .12em; color: var(--brand); margin-bottom: .75rem; }
.party-card p { font-size: .88rem; color: #aaa; margin-bottom: .25rem; }
.party-card strong { color: var(--text); }
.intro { background: var(--accent-bg); border-left: 3px solid var(--brand); padding: 1.25rem 1.5rem; border-radius: 0 6px 6px 0; margin-bottom: 3rem; font-size: .94rem; color: #ccc; }
h2 { font-family: 'Courier New',monospace; font-size: .73rem; text-transform: uppercase; letter-spacing: .15em; color: var(--brand); margin-top: 3rem; margin-bottom: 1rem; padding-bottom: .5rem; border-bottom: 1px solid var(--border); }
.clause-num { font-family: 'Courier New',monospace; font-size: .8rem; color: var(--brand); display: block; margin-bottom: .2rem; }
p { margin-bottom: 1rem; color: #ccc; }
ul, ol { margin: .75rem 0 1rem 1.5rem; color: #ccc; }
ul li, ol li { margin-bottom: .45rem; }
strong { color: var(--text); font-weight: 600; }
.box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; margin: 1.5rem 0; }
.box p { margin-bottom: .3rem; }
.box p:last-child { margin-bottom: 0; }
.legal-ref { font-family: 'Courier New',monospace; font-size: .7rem; color: #444; margin-left: .4rem; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
.sla-table { width: 100%; border-collapse: collapse; font-size: .88rem; margin: 1rem 0; }
.sla-table th { text-align: left; font-weight: 600; color: var(--text); font-size: .73rem; font-family: 'Courier New',monospace; text-transform: uppercase; letter-spacing: .07em; padding: .5rem .75rem; border-bottom: 1px solid var(--border); }
.sla-table td { padding: .6rem .75rem; color: #bbb; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: top; }
.sla-table tr:last-child td { border-bottom: none; }
.acceptance { background: var(--accent-bg); border: 1px solid rgba(16,185,129,0.2); border-radius: 10px; padding: 1.75rem; margin-top: 3.5rem; text-align: center; }
.acceptance p { color: #bbb; font-size: .88rem; margin-bottom: .4rem; }
.acceptance p:last-child { margin-bottom: 0; font-size: .8rem; color: #555; font-family: 'Courier New',monospace; }
footer { text-align: center; padding: 2rem; border-top: 1px solid var(--border); font-family: 'Courier New',monospace; font-size: .7rem; color: var(--muted); }
.sn { font-family: 'Courier New',monospace; font-size: .68rem; color: #444; margin-right: .4rem; }
@media (max-width:600px) { main { padding: 2rem 1.25rem 4rem; } .parties { grid-template-columns: 1fr; } }
`;

export default function ContratoPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <header>
        <div className="logo">⚡ ZapScript</div>
        <h1>Contrato de Prestação de Serviços de Tecnologia</h1>
        <p className="meta">Instrumento Particular Eletrônico — Versão 2.0 — Vigente a partir de 01/06/2025</p>
      </header>

      <main>
        <div className="parties">
          <div className="party-card">
            <div className="party-label">Contratada (Prestadora de Serviços)</div>
            <p><strong>FOX TECNOLOGIA LTDA</strong></p>
            <p>CNPJ: <strong>66.586.436/0001-12</strong></p>
            <p>Endereço: Rua João Alfredo, 152 – Nossa Senhora da Abadia</p>
            <p>Uberaba/MG — Brasil — CEP: 38025-300</p>
            <p>E-mail: <a href="mailto:contrato@zapscript.me">contrato@zapscript.me</a></p>
            <p>Representada por: Roberto Frattari Tulio Silva</p>
            <p>Cargo: Sócio-Administrador</p>
          </div>
          <div className="party-card">
            <div className="party-label">Contratante (Assinante)</div>
            <p>Pessoa física ou jurídica que realiza cadastro e efetua a contratação de plano na Plataforma ZapScript.</p>
            <p style={{ marginTop: '.5rem' }}>Dados identificados e registrados no momento do cadastro: nome/razão social, CPF/CNPJ, endereço de e-mail, conforme declarado pelo próprio Contratante.</p>
          </div>
        </div>

        <div className="intro">
          Por meio deste instrumento particular, celebrado em meio eletrônico com validade jurídica nos termos da Lei nº 14.063/2020 e da MP nº 2.200-2/2001, as partes acima identificadas firmam o presente <strong>Contrato de Prestação de Serviços de Tecnologia</strong>, regido pelas cláusulas seguintes e pela legislação brasileira vigente, aceitando-o eletronicamente no momento da contratação do plano.
        </div>

        <h2><span className="sn">Cláusula 1 /</span> Objeto do Contrato <span className="legal-ref">Art. 104 CC</span></h2>
        <p><span className="clause-num">1.1.</span> O objeto deste contrato é a prestação, pela Contratada ao Contratante, de serviços de transcrição automatizada de mensagens de voz do WhatsApp por meio de plataforma SaaS (Software as a Service) acessível em zapscript.me.</p>
        <p><span className="clause-num">1.2.</span> Os serviços abrangem: transcrição de áudios, painel de gerenciamento, histórico, exportação de transcrições e, conforme o plano contratado, acesso à API de integração e demais funcionalidades descritas em zapscript.me/precos.</p>
        <p><span className="clause-num">1.3.</span> O escopo exato, limites de uso e funcionalidades de cada plano constam na página de preços vigente no momento da contratação, que se incorpora a este instrumento por referência, podendo ser alterada nos termos da Cláusula 15.</p>
        <p><span className="clause-num">1.4.</span> O serviço de transcrição utiliza tecnologias de reconhecimento de fala (Speech-to-Text). A precisão das transcrições não é garantida em 100%, sendo influenciada por fatores como qualidade do áudio, ruído ambiente, sotaque e idioma, circunstâncias essas que não configuram descumprimento contratual.</p>

        <h2><span className="sn">Cláusula 2 /</span> Prazo e Vigência <span className="legal-ref">Art. 205 e 206 CC</span></h2>
        <p><span className="clause-num">2.1.</span> O contrato tem início na data de confirmação do pagamento pelo gateway contratado, com vigência equivalente ao plano escolhido (mensal: 30 dias; anual: 365 dias).</p>
        <p><span className="clause-num">2.2.</span> A renovação é automática ao término de cada período, salvo cancelamento expresso pelo Contratante até 24 horas antes da data de renovação ou solicitação formal nos termos da Cláusula 11.</p>
        <p><span className="clause-num">2.3.</span> A Contratada enviará notificação de renovação iminente por e-mail com antecedência mínima de 7 dias corridos para planos mensais e 30 dias corridos para planos anuais.</p>

        <h2><span className="sn">Cláusula 3 /</span> Remuneração e Condições de Pagamento <span className="legal-ref">Art. 315 ao 320 CC</span></h2>
        <p><span className="clause-num">3.1.</span> O Contratante pagará o valor do plano selecionado, conforme tabela de preços vigente em zapscript.me/precos no momento da contratação.</p>
        <p><span className="clause-num">3.2.</span> O pagamento é processado de forma recorrente e automática pelo gateway de pagamento <strong>Asaas</strong>, podendo ser realizado via cartão de crédito, PIX ou boleto bancário, conforme disponibilidade.</p>
        <p><span className="clause-num">3.3.</span> Em caso de falha no pagamento, a Contratada realizará até 3 tentativas de cobrança em 5 dias corridos. Persistindo o inadimplemento, o acesso será suspenso preventivamente até a regularização, sem prejuízo das obrigações pecuniárias do Contratante.</p>
        <p><span className="clause-num">3.4.</span> <strong>Reajuste:</strong> os valores poderão ser reajustados anualmente com base no <strong>Índice Geral de Preços do Mercado (IGPM/FGV)</strong> ou índice oficial substituto, com aviso prévio de 30 dias corridos. Reajustes superiores ao índice são considerados alterações materiais, conferindo ao Contratante o direito de rescisão sem multa no prazo de aviso.</p>
        <p><span className="clause-num">3.5.</span> Os valores são expressos em Reais (BRL) e poderão ser acrescidos de tributos incidentes sobre serviços de tecnologia, conforme legislação fiscal vigente.</p>

        <h2><span className="sn">Cláusula 4 /</span> Obrigações da Contratada <span className="legal-ref">Art. 389 e 475 CC</span></h2>
        <p>A Contratada se obriga a:</p>
        <ol>
          <li>Disponibilizar a plataforma com disponibilidade mensal mínima de <strong>99,5%</strong> (conforme Cláusula 8);</li>
          <li>Processar as transcrições com a qualidade técnica inerente à tecnologia STT utilizada;</li>
          <li>Excluir os áudios enviados em até 24 horas após o processamento, salvo configuração expressa do Contratante;</li>
          <li>Proteger os dados do Contratante nos termos da LGPD e da Política de Privacidade incorporada a este contrato;</li>
          <li>Prestar suporte técnico pelos canais e nos prazos definidos para o plano contratado;</li>
          <li>Notificar o Contratante com antecedência mínima de 24h sobre manutenções programadas;</li>
          <li>Notificar o Contratante em até 72h sobre incidentes de segurança que afetem seus dados pessoais (Art. 48 LGPD);</li>
          <li>Manter o sigilo absoluto sobre o conteúdo processado (áudios e transcrições);</li>
          <li>Emitir nota fiscal / comprovante de pagamento referente a cada cobrança realizada.</li>
        </ol>
        <p>O descumprimento de qualquer obrigação acima, quando imputável exclusivamente à Contratada e não sanado em até 10 dias úteis após notificação formal, confere ao Contratante o direito de rescisão com reembolso proporcional, nos termos da Cláusula 11.2.</p>

        <h2><span className="sn">Cláusula 5 /</span> Obrigações do Contratante <span className="legal-ref">Art. 422 CC — Boa-fé objetiva</span></h2>
        <p>O Contratante se obriga a:</p>
        <ol>
          <li>Fornecer informações cadastrais verdadeiras, completas e mantê-las atualizadas;</li>
          <li>Garantir que possui autorização legal ou consentimento dos titulares para transcrever os áudios processados, respondendo integralmente perante terceiros por violações à Lei nº 9.296/1996 e à LGPD;</li>
          <li>Manter sigilo e confidencialidade sobre suas credenciais de acesso, sendo o único responsável por acessos realizados com sua conta;</li>
          <li>Utilizar o serviço exclusivamente para os fins lícitos contratados, em conformidade com estes Termos e a legislação vigente;</li>
          <li>Realizar os pagamentos nas datas de vencimento acordadas;</li>
          <li>Não utilizar o serviço para finalidades ilícitas, fraudulentas ou que violem direitos de terceiros;</li>
          <li>Notificar imediatamente a Contratada em caso de suspeita de acesso não autorizado à sua conta.</li>
        </ol>

        <h2><span className="sn">Cláusula 6 /</span> Propriedade Intelectual e Licença <span className="legal-ref">Lei 9.609/98 · Lei 9.610/98</span></h2>
        <p><span className="clause-num">6.1.</span> A Contratada detém todos os direitos de propriedade intelectual sobre a plataforma ZapScript, incluindo código-fonte, design, marcas, metodologias e APIs, protegidos pelas Leis nº 9.609/1998 e 9.610/1998.</p>
        <p><span className="clause-num">6.2.</span> Este contrato concede ao Contratante licença de uso <strong>não exclusiva, pessoal, intransferível e revogável</strong>, limitada ao plano contratado, exclusivamente para os fins descritos na Cláusula 1.</p>
        <p><span className="clause-num">6.3.</span> O Contratante retém titularidade integral sobre os áudios enviados e as transcrições geradas. A Contratada recebe licença técnica irrevogável, porém limitada ao processamento necessário para a prestação do serviço.</p>
        <p><span className="clause-num">6.4.</span> É vedado ao Contratante: realizar engenharia reversa, descompilar, adaptar, distribuir ou criar obras derivadas da plataforma, parcial ou totalmente, sem autorização escrita prévia da Contratada.</p>
        <p><span className="clause-num">6.5.</span> A Contratada <strong>não utilizará</strong> o conteúdo do Contratante para treinamento de modelos de inteligência artificial, monetização de dados ou qualquer finalidade além da prestação do serviço contratado.</p>

        <h2><span className="sn">Cláusula 7 /</span> Confidencialidade e Sigilo <span className="legal-ref">Art. 195 Lei 9.279/96 · Art. 1.011 CC</span></h2>
        <p><span className="clause-num">7.1.</span> Ambas as partes se comprometem a manter em sigilo absoluto todas as informações confidenciais obtidas em razão deste contrato, incluindo dados técnicos, comerciais, financeiros, metodológicos e de clientes da outra parte.</p>
        <p><span className="clause-num">7.2.</span> Esta obrigação de confidencialidade persiste por <strong>5 (cinco) anos</strong> após o encerramento deste contrato, independentemente do motivo da rescisão.</p>
        <p><span className="clause-num">7.3.</span> Excetua-se da obrigação de sigilo as informações que: (i) já sejam de domínio público por fato não imputável às partes; (ii) devam ser divulgadas por determinação judicial ou administrativa; (iii) tenham sido obtidas legitimamente de terceiros sem restrição de confidencialidade.</p>
        <p><span className="clause-num">7.4.</span> A violação desta cláusula acarretará além das sanções da Cláusula 9 (cláusula penal), a reparação integral de danos e lucros cessantes comprovados, conforme Art. 403 CC.</p>

        <h2><span className="sn">Cláusula 8 /</span> Nível de Serviço (SLA) e Créditos</h2>
        <p><span className="clause-num">8.1.</span> A Contratada garante os seguintes níveis mínimos de serviço:</p>
        <table className="sla-table">
          <thead><tr><th>Métrica</th><th>Compromisso</th><th>Período de Apuração</th></tr></thead>
          <tbody>
            <tr><td>Disponibilidade da plataforma</td><td>≥ 99,5%</td><td>Mensal</td></tr>
            <tr><td>Manutenção programada (aviso prévio)</td><td>≥ 24 horas</td><td>Por evento</td></tr>
            <tr><td>Início de mitigação em incidente crítico</td><td>≤ 4 horas</td><td>Por incidente</td></tr>
            <tr><td>Resposta a chamados de suporte (plano pago)</td><td>≤ 24h úteis</td><td>Por chamado</td></tr>
          </tbody>
        </table>
        <p><span className="clause-num">8.2.</span> <strong>Créditos por descumprimento de SLA:</strong> downtime não programado superior a 4 horas contínuas em um mês gera direito a crédito proporcional ao período de indisponibilidade, calculado sobre o valor mensalidade vigente. Solicitação deve ser feita em até 30 dias após o incidente via <a href="mailto:suporte@zapscript.me">suporte@zapscript.me</a>.</p>
        <p><span className="clause-num">8.3.</span> Não são contabilizados como downtime: manutenções programadas com aviso, interrupções por força maior (Cláusula 10), falhas imputáveis ao Contratante ou a provedores do próprio Contratante.</p>

        <h2><span className="sn">Cláusula 9 /</span> Cláusula Penal <span className="legal-ref">Art. 408 ao 416 CC</span></h2>
        <p><span className="clause-num">9.1.</span> <strong>Por descumprimento pelo Contratante:</strong> em caso de violação das obrigações da Cláusula 5 ou uso indevido descrito nos Termos de Serviço, o Contratante ficará sujeito a multa de <strong>2 vezes o valor mensal da assinatura vigente</strong>, sem prejuízo das perdas e danos apurados.</p>
        <p><span className="clause-num">9.2.</span> <strong>Por descumprimento pela Contratada:</strong> em caso de interrupção não justificada do serviço por período superior ao SLA previsto na Cláusula 8, ou violação comprovada de confidencialidade, a Contratada ficará sujeita a crédito de serviço de <strong>1 mês de assinatura</strong>, sem prejuízo das demais penalidades legais aplicáveis.</p>
        <p><span className="clause-num">9.3.</span> As multas previstas nesta cláusula são compensatórias e não excluem o direito à reparação integral de danos excedentes devidamente comprovados (Art. 416 § único CC).</p>

        <h2><span className="sn">Cláusula 10 /</span> Força Maior e Caso Fortuito <span className="legal-ref">Art. 393 CC</span></h2>
        <p><span className="clause-num">10.1.</span> Nenhuma das partes será responsabilizada por inadimplemento decorrente de força maior ou caso fortuito, nos termos do Art. 393 do Código Civil, incluindo: fenômenos naturais, pandemias, guerras, atos de autoridade pública, greves gerais, falhas de infraestrutura de terceiros (backbone de internet, provedores de nuvem), ataques cibernéticos de larga escala e instabilidades nos serviços do WhatsApp/Meta.</p>
        <p><span className="clause-num">10.2.</span> A parte afetada notificará a outra em até 3 dias úteis do início do evento, informando natureza, extensão e previsão de duração. Cessado o evento, as obrigações serão retomadas em prazo razoável acordado entre as partes.</p>
        <p><span className="clause-num">10.3.</span> Caso o evento de força maior perdure por mais de 30 dias corridos, qualquer das partes poderá rescindir o contrato sem multa, com reembolso proporcional ao período não utilizado.</p>

        <h2><span className="sn">Cláusula 11 /</span> Rescisão e Notificação Formal <span className="legal-ref">Art. 473 e 475 CC</span></h2>
        <p><span className="clause-num">11.1. Rescisão por iniciativa do Contratante:</span> a qualquer tempo via painel da plataforma ou e-mail formal a <a href="mailto:contrato@zapscript.me">contrato@zapscript.me</a>. O acesso permanece ativo até o fim do período pago. Reembolso conforme Cláusula 3 e Termos de Serviço.</p>
        <p><span className="clause-num">11.2. Rescisão por iniciativa da Contratada sem justa causa:</span> mediante notificação extrajudicial com prazo mínimo de <strong>30 dias corridos</strong>, com reembolso proporcional ao período não utilizado, calculado pro rata die.</p>
        <p><span className="clause-num">11.3. Rescisão com justa causa (Contratada rescinde):</span> imediata, sem reembolso, nos casos de: (i) violação reiterada das obrigações da Cláusula 5 após advertência formal; (ii) uso ilícito da plataforma; (iii) inadimplemento superior a 15 dias corridos após 3 tentativas de cobrança. Precedida de notificação formal com prazo de 5 dias úteis para manifestação do Contratante, exceto em casos de urgência ou ilicitude grave.</p>
        <p><span className="clause-num">11.4. Rescisão com justa causa (Contratante rescinde):</span> o Contratante poderá rescindir imediatamente, com direito a reembolso proporcional, comprovando descumprimento relevante das obrigações da Cláusula 4 não sanado em 10 dias úteis após notificação formal.</p>
        <p><span className="clause-num">11.5.</span> Após qualquer modalidade de rescisão, os dados do Contratante ficam disponíveis para exportação por 30 dias corridos, sendo após eliminados conforme Política de Privacidade e Art. 16 LGPD.</p>

        <h2><span className="sn">Cláusula 12 /</span> Vedação de Cessão <span className="legal-ref">Art. 286 e 299 CC</span></h2>
        <p><span className="clause-num">12.1.</span> O Contratante não poderá ceder, transferir ou sub-rogar qualquer direito ou obrigação decorrente deste contrato a terceiros sem consentimento escrito prévio da Contratada.</p>
        <p><span className="clause-num">12.2.</span> A Contratada poderá ceder este contrato em caso de reorganização societária, fusão, incorporação ou venda de ativos, desde que o cessionário assuma integralmente todas as obrigações aqui previstas e o Contratante seja notificado com 30 dias de antecedência, podendo rescindir sem ônus nesse período.</p>
        <p><span className="clause-num">12.3.</span> É vedada a cessão de créditos decorrentes deste contrato por qualquer das partes sem anuência expressa e por escrito da outra.</p>

        <h2><span className="sn">Cláusula 13 /</span> Direito de Verificação e Auditoria <span className="legal-ref">Art. 422 CC — Boa-fé · Art. 37 LGPD</span></h2>
        <p><span className="clause-num">13.1.</span> O Contratante tem o direito de solicitar, a qualquer momento e mediante aviso prévio de 5 dias úteis, relatórios sobre o tratamento de seus dados pessoais realizado pela Contratada, incluindo suboperadores, nos termos do Art. 37 da LGPD.</p>
        <p><span className="clause-num">13.2.</span> A Contratada disponibilizará o Relatório de Impacto à Proteção de Dados (RIPD) à ANPD quando solicitado, conforme Art. 38 LGPD.</p>
        <p><span className="clause-num">13.3.</span> Auditorias de conformidade técnica (segurança, SLA, proteção de dados) poderão ser solicitadas pelo Contratante com periodicidade máxima anual, respondidas pela Contratada em até 15 dias úteis com relatório formal.</p>

        <h2><span className="sn">Cláusula 14 /</span> Disposições Gerais <span className="legal-ref">Art. 113, 184 e 421 CC</span></h2>
        <p><span className="clause-num">14.1. Idioma:</span> este contrato é redigido em língua portuguesa, sendo esta a versão oficial para todos os fins de interpretação e execução no Brasil.</p>
        <p><span className="clause-num">14.2. Independência das disposições (Severability):</span> a invalidade ou inexequibilidade de qualquer cláusula não afetará as demais, que permanecem em pleno vigor (Art. 184 CC).</p>
        <p><span className="clause-num">14.3. Integralidade (Merger Clause):</span> este contrato, juntamente com os Termos de Serviço e a Política de Privacidade, representa o acordo integral entre as partes, substituindo todos os entendimentos anteriores sobre o mesmo objeto.</p>
        <p><span className="clause-num">14.4. Renúncia:</span> a tolerância de qualquer das partes ao descumprimento de obrigações não constitui novação, moratória ou renúncia a direitos presentes ou futuros.</p>
        <p><span className="clause-num">14.5. Validade eletrônica:</span> a aceitação eletrônica deste contrato, realizada mediante duplo consentimento (checkbox) no ato de cadastro, tem plena validade jurídica nos termos da Lei nº 14.063/2020 (Assinaturas Eletrônicas) e da MP nº 2.200-2/2001 (ICP-Brasil), constituindo prova suficiente de conclusão do negócio jurídico.</p>

        <h2><span className="sn">Cláusula 15 /</span> Alterações Contratuais <span className="legal-ref">Art. 49 CDC · Art. 422 CC</span></h2>
        <p><span className="clause-num">15.1.</span> A Contratada poderá modificar as condições contratuais mediante notificação por e-mail com antecedência mínima de <strong>15 dias corridos</strong> para alterações não materiais e <strong>30 dias corridos</strong> para alterações materiais (que afetem preços, funcionalidades principais ou responsabilidades).</p>
        <p><span className="clause-num">15.2.</span> O uso continuado do serviço após a vigência das alterações implica aceitação tácita. O Contratante que discordar poderá rescindir sem multa dentro do prazo de aviso.</p>

        <h2><span className="sn">Cláusula 16 /</span> Lei Aplicável, Foro e Resolução de Disputas <span className="legal-ref">Art. 101 CDC · Art. 63 CPC · Lei 9.307/96</span></h2>
        <div className="box">
          <p>Este contrato é regido integralmente pelas leis da <strong>República Federativa do Brasil</strong>, especialmente: Código Civil (Lei nº 10.406/2002), Código de Defesa do Consumidor (Lei nº 8.078/1990 — quando aplicável), Lei Geral de Proteção de Dados (Lei nº 13.709/2018), Marco Civil da Internet (Lei nº 12.965/2014) e Lei de Software (Lei nº 9.609/1998).</p>
          <p style={{ marginTop: '.75rem' }}><strong>Resolução de disputas:</strong> as partes buscarão, primeiramente, a solução amigável. Não havendo acordo em 15 dias, poderão eleger, em comum acordo, mediação (Lei 13.140/2015) ou arbitragem (Lei 9.307/1996).</p>
          <p style={{ marginTop: '.75rem' }}><strong>Foro contratual:</strong> na impossibilidade de solução extrajudicial, fica eleito o Foro da Comarca de <strong>Uberaba/MG</strong>, com renúncia a qualquer outro por mais privilegiado que seja, ressalvado o direito do consumidor de eleger o foro de seu domicílio (Art. 101, I, CDC).</p>
        </div>

        <div className="acceptance">
          <p><strong>Aceite Eletrônico</strong></p>
          <p>A vinculação a este contrato ocorre de forma eletrônica mediante aceite expresso (checkbox duplo) no ato de cadastro e contratação do plano. O Contratante declara expressamente que leu, compreendeu e concordou integralmente com todas as cláusulas deste instrumento, bem como com os Termos de Serviço e a Política de Privacidade incorporados por referência.</p>
          <p>O registro de timestamp, versão dos documentos, IP e dados do aceite são preservados como prova de consentimento nos termos do Art. 8º §2º LGPD e Art. 225 CC.</p>
          <p>Lei nº 14.063/2020 · MP nº 2.200-2/2001 · Art. 107 CC · Art. 225 CC</p>
        </div>
      </main>

      <footer>
        © 2025 ZapScript &nbsp;·&nbsp; Todos os direitos reservados &nbsp;·&nbsp;
        <a href="/termos">Termos de Serviço</a> &nbsp;·&nbsp;
        <a href="/contrato">Contrato de Prestação</a> &nbsp;·&nbsp;
        <a href="/privacidade">Política de Privacidade</a>
      </footer>
    </>
  );
}
