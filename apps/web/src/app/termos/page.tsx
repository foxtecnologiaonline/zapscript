import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Termos de Serviço — ZapScript',
  description: 'Termos de Serviço da plataforma ZapScript. Versão 2.0, vigente a partir de 01/06/2025.',
};

const css = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --brand: #10b981; --bg: #0d0d0d; --surface: #161616; --surface2: #1c1c1c;
  --border: rgba(255,255,255,0.08); --text: #f0f0f0; --muted: #777;
  --accent-bg: rgba(16,185,129,0.07); --warn-bg: rgba(255,180,0,0.06);
  --warn-border: rgba(255,180,0,0.2);
}
body { font-family: 'Georgia','Times New Roman',serif; background: var(--bg); color: var(--text); line-height: 1.85; font-size: 16px; }
header { border-bottom: 1px solid var(--border); padding: 2rem 0; text-align: center; background: var(--surface); }
.logo { font-family: 'Courier New',monospace; font-size: 1.1rem; color: var(--brand); letter-spacing: .1em; text-transform: uppercase; margin-bottom: .5rem; }
header h1 { font-size: 1.6rem; font-weight: normal; letter-spacing: -.02em; }
header .meta { font-family: 'Courier New',monospace; font-size: .72rem; color: var(--muted); margin-top: .5rem; }
main { max-width: 780px; margin: 0 auto; padding: 3rem 2rem 5rem; }
.intro { background: var(--accent-bg); border-left: 3px solid var(--brand); padding: 1.25rem 1.5rem; border-radius: 0 6px 6px 0; margin-bottom: 3rem; font-size: .94rem; color: #ccc; }
h2 { font-family: 'Courier New',monospace; font-size: .73rem; text-transform: uppercase; letter-spacing: .15em; color: var(--brand); margin-top: 3rem; margin-bottom: 1rem; padding-bottom: .5rem; border-bottom: 1px solid var(--border); }
p { margin-bottom: 1rem; color: #ccc; }
ul, ol { margin: .75rem 0 1rem 1.5rem; color: #ccc; }
ul li, ol li { margin-bottom: .45rem; }
strong { color: var(--text); font-weight: 600; }
.box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem 1.5rem; margin: 1.5rem 0; }
.box p { margin-bottom: .3rem; }
.box p:last-child { margin-bottom: 0; }
.warn-box { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 8px; padding: 1.1rem 1.4rem; margin: 1.5rem 0; }
.warn-box p { color: #d4aa40; font-size: .9rem; margin-bottom: 0; }
.legal-ref { font-family: 'Courier New',monospace; font-size: .7rem; color: #444; margin-left: .4rem; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
.regime-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.25rem 0; }
.regime-card { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.125rem; }
.regime-card .rc-title { font-family: 'Courier New',monospace; font-size: .7rem; text-transform: uppercase; letter-spacing: .1em; color: var(--brand); margin-bottom: .5rem; }
.regime-card p { font-size: .85rem; color: #aaa; margin-bottom: .3rem; }
.escalation-list { list-style: none; margin: .75rem 0 1rem 0; }
.escalation-list li { display: flex; gap: .75rem; padding: .6rem .75rem; border-radius: 6px; background: var(--surface2); margin-bottom: .4rem; align-items: flex-start; font-size: .9rem; color: #bbb; }
.escalation-list li .step { font-family: 'Courier New',monospace; font-size: .7rem; color: var(--brand); min-width: 80px; margin-top: 2px; }
.table-legal { width: 100%; border-collapse: collapse; font-size: .88rem; margin: 1rem 0; }
.table-legal th { text-align: left; font-weight: 600; color: var(--text); font-size: .73rem; font-family: 'Courier New',monospace; text-transform: uppercase; letter-spacing: .07em; padding: .5rem .75rem; border-bottom: 1px solid var(--border); }
.table-legal td { padding: .6rem .75rem; color: #bbb; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: top; }
.table-legal tr:last-child td { border-bottom: none; }
footer { text-align: center; padding: 2rem; border-top: 1px solid var(--border); font-family: 'Courier New',monospace; font-size: .7rem; color: var(--muted); }
.sn { font-family: 'Courier New',monospace; font-size: .68rem; color: #444; margin-right: .4rem; }
@media (max-width:600px) { main { padding: 2rem 1.25rem 4rem; } .regime-grid { grid-template-columns: 1fr; } }
`;

export default function TermosPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <header>
        <div className="logo">⚡ ZapScript</div>
        <h1>Termos de Serviço</h1>
        <p className="meta">Versão 2.0 &nbsp;·&nbsp; Vigente a partir de 01/06/2025 &nbsp;·&nbsp; Aplica-se a todos os usuários e assinantes</p>
      </header>

      <main>
        <div className="intro">
          Estes Termos de Serviço regem o acesso e uso da plataforma <strong>ZapScript</strong> (zapscript.me) e constituem um contrato vinculante entre o usuário e a ZapScript. Leia integralmente antes de utilizar o serviço. <strong>A utilização da plataforma pressupõe a leitura e ciência destes Termos; a adesão efetiva ocorre mediante aceite eletrônico expresso no cadastro.</strong>
        </div>

        <h2><span className="sn">01 /</span> Definições</h2>
        <ul>
          <li><strong>&ldquo;ZapScript&rdquo;</strong> ou <strong>&ldquo;Plataforma&rdquo;:</strong> serviço SaaS de conversão de áudios, disponível em zapscript.me, operado pela empresa identificada na Política de Privacidade;</li>
          <li><strong>&ldquo;Usuário Consumidor&rdquo;:</strong> pessoa física que utiliza o serviço para finalidade pessoal, sujeita ao Código de Defesa do Consumidor (Lei nº 8.078/1990);</li>
          <li><strong>&ldquo;Usuário Empresarial&rdquo;:</strong> pessoa jurídica ou profissional que utiliza o serviço no exercício de atividade empresarial, sujeita prioritariamente ao Código Civil e disposições B2B;</li>
          <li><strong>&ldquo;Conteúdo&rdquo;:</strong> áudios enviados, conversões geradas e demais materiais inseridos na plataforma pelo usuário;</li>
          <li><strong>&ldquo;Assinatura&rdquo;:</strong> plano de acesso pago com cobrança recorrente (mensal ou anual);</li>
          <li><strong>&ldquo;API&rdquo;:</strong> interface de programação de aplicações disponível em planos elegíveis;</li>
          <li><strong>&ldquo;Downtime&rdquo;:</strong> período de indisponibilidade do serviço principal, excluídas manutenções programadas com aviso prévio.</li>
        </ul>

        <h2><span className="sn">02 /</span> Aceitação, Elegibilidade e Regime Aplicável <span className="legal-ref">Art. 3º e 4º CDC · Art. 421 CC</span></h2>
        <p>Para utilizar o ZapScript você deve:</p>
        <ul>
          <li>Ter capacidade civil plena — 18 anos ou mais, ou legalmente emancipado (Art. 5º CC);</li>
          <li>Fornecer informações verdadeiras, completas e atualizadas no cadastro;</li>
          <li>Não ter conta anteriormente encerrada por violação destes Termos;</li>
          <li>Aceitar expressamente estes Termos e a Política de Privacidade via checkbox no cadastro.</li>
        </ul>
        <div className="regime-grid">
          <div className="regime-card">
            <div className="rc-title">Usuário Consumidor (PF)</div>
            <p>Aplicam-se integralmente o CDC (Lei 8.078/90), o Marco Civil da Internet (Lei 12.965/14) e o Decreto nº 7.962/2013 (e-commerce).</p>
            <p>Direito de arrependimento de <strong>7 dias corridos</strong> após a contratação online — Art. 49 CDC.</p>
          </div>
          <div className="regime-card">
            <div className="rc-title">Usuário Empresarial (PJ)</div>
            <p>Aplicam-se o Código Civil (Lei 10.406/02) e a legislação empresarial. O CDC não se aplica nas relações B2B.</p>
            <p>A limitação de responsabilidade e demais cláusulas são integralmente válidas neste regime.</p>
          </div>
        </div>

        <h2><span className="sn">03 /</span> Descrição do Serviço e Isenções Técnicas</h2>
        <p>O ZapScript oferece conversão automatizada de mensagens de voz do WhatsApp via tecnologias de Speech-to-Text (STT). O serviço inclui: conversão em português e demais idiomas conforme plano, painel de gerenciamento com histórico, exportação de conversões e, nos planos elegíveis, acesso à API de integração.</p>
        <div className="warn-box">
          <p>⚠ <strong>Limitação técnica inerente:</strong> a precisão das conversões depende de fatores externos à ZapScript, incluindo qualidade do áudio, nível de ruído, sotaque, dicção e idioma. Nenhum sistema STT atual atinge 100% de precisão. A ZapScript não se responsabiliza por decisões tomadas com base exclusiva em conversões automáticas sem revisão humana.</p>
        </div>
        <p>A ZapScript não é afiliada, patrocinada ou endossada pelo WhatsApp ou Meta Platforms. O uso da plataforma deve estar em conformidade com os termos de serviço do WhatsApp.</p>

        <h2><span className="sn">04 /</span> Planos, Assinaturas e Reajuste <span className="legal-ref">Art. 46 e 51 CDC · Art. 317 CC</span></h2>
        <p>O ZapScript opera exclusivamente no modelo de assinatura recorrente com renovação automática. Os planos, limites e valores vigentes estão disponíveis em <a href="https://www.zapscript.me/precos">zapscript.me/precos</a>.</p>
        <table className="table-legal">
          <thead><tr><th>Plano</th><th>Ciclo</th><th>Renovação</th><th>Cancelamento</th></tr></thead>
          <tbody>
            <tr><td>Mensal</td><td>30 dias</td><td>Automática</td><td>A qualquer momento; acesso mantido até fim do período pago</td></tr>
            <tr><td>Anual</td><td>365 dias</td><td>Automática, com aviso 30 dias antes</td><td>A qualquer momento; sem reembolso proporcional após período de arrependimento</td></tr>
          </tbody>
        </table>
        <ul>
          <li><strong>Reajuste de preços:</strong> os valores poderão ser reajustados anualmente com base no <strong>IGPM/FGV</strong> ou índice oficial substituto, mediante aviso prévio de <strong>30 dias corridos</strong>. Reajustes acima do índice constituem alteração material e sujeitam-se ao prazo de 30 dias para aceite ou cancelamento sem multa.</li>
          <li><strong>Falha de cobrança:</strong> até 3 tentativas automáticas em 5 dias corridos. Persistindo a falha, acesso suspenso preventivamente até regularização.</li>
          <li><strong>Impostos:</strong> os valores exibidos são acrescidos de tributos aplicáveis conforme legislação fiscal vigente.</li>
        </ul>

        <h2><span className="sn">05 /</span> Direito de Arrependimento e Reembolso <span className="legal-ref">Art. 49 CDC · Decreto 7.962/2013</span></h2>
        <ul>
          <li><strong>Arrependimento (Usuário Consumidor):</strong> reembolso integral em até 7 dias corridos após a primeira contratação, sem necessidade de justificativa, conforme Art. 49 CDC. Solicitação via <a href="mailto:suporte@zapscript.me">suporte@zapscript.me</a>.</li>
          <li><strong>Renovação automática:</strong> o usuário pode solicitar cancelamento da renovação e reembolso em até 48 horas após a cobrança, mediante análise do histórico de uso.</li>
          <li><strong>Plano anual fora do período de arrependimento:</strong> não há reembolso proporcional, salvo encerramento sem justa causa por iniciativa da ZapScript.</li>
          <li><strong>Processamento:</strong> reembolsos aprovados são processados em até 10 dias úteis para o mesmo meio de pagamento original.</li>
        </ul>

        <h2><span className="sn">06 /</span> Uso Aceitável e Sanções Escalonadas <span className="legal-ref">Art. 187 CC · Art. 927 CC</span></h2>
        <p>É <strong>expressamente vedado</strong> utilizar a ZapScript para:</p>
        <ul>
          <li>Converter áudios sem consentimento do emissor — violação à Lei nº 9.296/1996 (interceptação) e Art. 5º XII CF;</li>
          <li>Processar conteúdo ilegal, difamatório, discriminatório, que incite violência ou viole direitos de terceiros;</li>
          <li>Realizar engenharia reversa, descompilar ou extrair código-fonte da plataforma — Lei nº 9.609/1998 (Software);</li>
          <li>Revender, sublicenciar ou criar produtos derivados sem autorização escrita prévia;</li>
          <li>Sobrecarregar deliberadamente a infraestrutura (DDoS, abuso de API) — Lei nº 12.737/2012 (crimes cibernéticos);</li>
          <li>Criar contas falsas, compartilhar credenciais ou burlar limites de plano por meios técnicos;</li>
          <li>Utilizar a plataforma para processar dados pessoais de terceiros sem base legal adequada (LGPD).</li>
        </ul>
        <p>As infrações sujeitam o usuário às seguintes sanções, aplicadas de forma escalonada e proporcional à gravidade:</p>
        <ul className="escalation-list">
          <li><span className="step">1ª — Advertência</span> Notificação por e-mail com prazo de 48h para correção, para infrações leves e de primeira ocorrência.</li>
          <li><span className="step">2ª — Suspensão</span> Bloqueio temporário do acesso (7 a 30 dias) para infrações reincidentes ou de gravidade moderada.</li>
          <li><span className="step">3ª — Encerramento</span> Rescisão imediata do contrato sem reembolso para infrações graves, reiteradas ou com impacto em terceiros.</li>
          <li><span className="step">4ª — Legal</span> Notificação extrajudicial e/ou medidas judiciais cabíveis para condutas que configurem ilícito civil ou penal.</li>
        </ul>

        <h2><span className="sn">07 /</span> Propriedade Intelectual <span className="legal-ref">Lei 9.279/96 · Lei 9.610/98 · Lei 9.609/98</span></h2>
        <p><strong>Da plataforma:</strong> o código-fonte, design, marcas, logotipos, metodologias e toda a propriedade intelectual da ZapScript são de titularidade exclusiva da empresa, protegidos pelas Leis nº 9.279/1996, 9.610/1998 e 9.609/1998. É vedada qualquer reprodução, adaptação ou uso sem autorização escrita.</p>
        <p><strong>Do conteúdo do usuário:</strong> o usuário mantém integral titularidade sobre os áudios enviados e as conversões geradas. Ao usar o serviço, concede à ZapScript licença técnica <strong>não exclusiva, intransferível, revogável e limitada</strong> para processar o conteúdo exclusivamente para a prestação do serviço contratado.</p>
        <p>A ZapScript <strong>não utilizará</strong> o conteúdo do usuário para treinamento de modelos de inteligência artificial, pesquisa ou qualquer finalidade além da conversão solicitada, sem consentimento expresso e específico do titular.</p>

        <h2><span className="sn">08 /</span> Marco Civil da Internet <span className="legal-ref">Lei nº 12.965/2014</span></h2>
        <p>Na qualidade de provedor de aplicações de internet, a ZapScript observa integralmente as disposições da Lei nº 12.965/2014 (Marco Civil da Internet), especialmente:</p>
        <ul>
          <li><strong>Art. 7º:</strong> respeito à inviolabilidade e ao sigilo das comunicações do usuário;</li>
          <li><strong>Art. 15:</strong> guarda de logs de acesso pelo prazo de 6 meses;</li>
          <li><strong>Art. 19:</strong> responsabilidade civil por conteúdo de terceiros apenas após notificação judicial (safe harbor);</li>
          <li><strong>Art. 21:</strong> remoção imediata de conteúdo que viole a intimidade sexual de pessoas.</li>
        </ul>

        <h2><span className="sn">09 /</span> Disponibilidade, SLA e Manutenção</h2>
        <p>A ZapScript se compromete com os seguintes níveis de serviço (SLA):</p>
        <ul>
          <li><strong>Disponibilidade mensal:</strong> meta de 99,5% de uptime, excluídas janelas de manutenção programada;</li>
          <li><strong>Manutenção programada:</strong> informada com no mínimo 24h de antecedência por e-mail e/ou painel;</li>
          <li><strong>Tempo de resposta a incidentes críticos:</strong> até 4 horas para início de mitigação.</li>
        </ul>
        <p>Em caso de downtime não programado superior a 4 horas contínuas em um mês, o usuário poderá solicitar crédito proporcional ao período de indisponibilidade, calculado sobre o valor mensal vigente. A solicitação deve ser feita em até 30 dias após o incidente.</p>

        <h2><span className="sn">10 /</span> Força Maior e Caso Fortuito <span className="legal-ref">Art. 393 CC · Art. 188 II CC</span></h2>
        <p>Nenhuma das partes será responsabilizada pelo descumprimento de obrigações decorrente de evento de força maior ou caso fortuito, nos termos do Art. 393 do Código Civil, incluindo sem limitação: fenômenos naturais, guerras, pandemias, atos governamentais, falhas de infraestrutura de terceiros (redes de telecomunicação, data centers, nuvem), ataques cibernéticos de larga escala e instabilidades nos serviços do WhatsApp ou Meta.</p>
        <p>A parte afetada deverá notificar a outra em até 5 dias úteis do início do evento, com descrição da natureza, extensão e duração estimada. Cessado o evento, as obrigações serão retomadas no prazo combinado entre as partes.</p>

        <h2><span className="sn">11 /</span> Limitação de Responsabilidade <span className="legal-ref">Art. 14 §3º CDC · Art. 944 CC</span></h2>
        <p>A ZapScript não se responsabiliza por:</p>
        <ul>
          <li>Imprecisões nas conversões decorrentes de qualidade de áudio, sotaque, ruído ou idioma não suportado;</li>
          <li>Decisões, prejuízos ou consequências resultantes do uso das conversões pelo usuário ou por terceiros;</li>
          <li>Perdas indiretas, lucros cessantes, perda de dados ou danos emergentes, em qualquer hipótese;</li>
          <li>Falhas ou indisponibilidade de serviços de terceiros (WhatsApp, APIs externas, gateways de pagamento);</li>
          <li>Atos praticados por terceiros não autorizados que resultem de negligência do usuário na guarda de credenciais.</li>
        </ul>
        <div className="box">
          <p><strong>Usuário Empresarial (B2B):</strong> a responsabilidade total da ZapScript, em qualquer hipótese, fica limitada ao valor total pago pelo contratante nos últimos <strong>3 meses</strong> de assinatura. Esta limitação é válida entre partes empresariais nos termos do Art. 944 CC.</p>
          <p style={{ marginTop: '.5rem' }}><strong>Usuário Consumidor (B2C):</strong> a limitação acima não se aplica para relações de consumo, prevalecendo as disposições do CDC, especialmente o Art. 14 e 51, IV, que vedam cláusulas que impossibilitem ou dificultem o ressarcimento de danos ao consumidor.</p>
        </div>

        <h2><span className="sn">12 /</span> Suspensão e Encerramento</h2>
        <p>A ZapScript poderá suspender ou encerrar contas conforme os procedimentos da Cláusula 6 (sanções escalonadas). Adicionalmente:</p>
        <ul>
          <li><strong>Encerramento por violação (justa causa):</strong> imediato, sem reembolso, com notificação por e-mail informando o motivo;</li>
          <li><strong>Encerramento por iniciativa da ZapScript sem justa causa:</strong> aviso prévio de 30 dias, com reembolso proporcional ao período não utilizado;</li>
          <li><strong>Encerramento por iniciativa do usuário:</strong> via painel ou e-mail, com acesso mantido até o fim do período pago.</li>
        </ul>
        <p>Após o encerramento, os dados do usuário ficam disponíveis para exportação por 30 dias, sendo após eliminados conforme Política de Privacidade.</p>

        <h2><span className="sn">13 /</span> Resolução de Disputas e Mediação <span className="legal-ref">Lei 9.307/96 · Lei 13.140/2015</span></h2>
        <p>As partes se comprometem a buscar, primeiramente, a resolução amigável de conflitos mediante comunicação formal ao e-mail <a href="mailto:suporte@zapscript.me">suporte@zapscript.me</a>, com prazo de 15 dias corridos para resposta e negociação.</p>
        <p>Não havendo acordo, as partes poderão, de comum acordo, submeter a disputa a mediação extrajudicial nos termos da Lei nº 13.140/2015, ou a arbitragem nos termos da Lei nº 9.307/1996, perante câmara arbitral a ser definida. Esta cláusula não impede a parte de recorrer ao Poder Judiciário para medidas urgentes e cautelares.</p>
        <p>Para relações de consumo, o usuário consumidor pode utilizar os canais oficiais: Procon estadual, plataforma <a href="https://consumidor.gov.br" target="_blank" rel="noreferrer">consumidor.gov.br</a> e Juizado Especial Cível.</p>

        <h2><span className="sn">14 /</span> Cessão e Modificação do Contrato <span className="legal-ref">Art. 299 CC</span></h2>
        <p>O usuário não pode ceder ou transferir seus direitos ou obrigações decorrentes destes Termos sem consentimento escrito prévio da ZapScript.</p>
        <p>A ZapScript poderá ceder estes Termos a terceiro em caso de reorganização societária, fusão, aquisição ou venda de ativos, desde que o cessionário assuma integralmente as obrigações aqui previstas e os usuários sejam notificados com 30 dias de antecedência, podendo cancelar sem ônus nesse período.</p>

        <h2><span className="sn">15 /</span> Independência das Disposições e Integralidade <span className="legal-ref">Art. 184 CC</span></h2>
        <p><strong>Severability:</strong> a invalidade ou inexequibilidade de qualquer disposição destes Termos não afetará a validade das demais, que permanecerão em pleno vigor e efeito, nos termos do Art. 184 do Código Civil.</p>
        <p><strong>Integralidade (Merger Clause):</strong> estes Termos, juntamente com a Política de Privacidade e o Contrato de Prestação de Serviços, constituem o acordo integral entre as partes em relação ao seu objeto, substituindo todos os entendimentos anteriores, escritos ou verbais.</p>
        <p><strong>Renúncia:</strong> a omissão da ZapScript em exigir o cumprimento de qualquer disposição destes Termos não constituirá renúncia a direitos presentes ou futuros.</p>

        <h2><span className="sn">16 /</span> Alterações nos Termos <span className="legal-ref">Art. 46 CDC</span></h2>
        <p>A ZapScript poderá modificar estes Termos a qualquer momento. Alterações materiais (que afetem direitos do usuário, preços ou responsabilidades) serão comunicadas por e-mail com antecedência mínima de <strong>15 dias corridos</strong>. O uso continuado após a vigência das alterações implica aceitação. Caso o usuário não concorde, poderá cancelar a assinatura dentro do prazo de aviso sem multa por rescisão antecipada.</p>

        <h2><span className="sn">17 /</span> Lei Aplicável e Foro <span className="legal-ref">Art. 101 CDC · Art. 63 CPC</span></h2>
        <div className="box">
          <p>Estes Termos são regidos pelas leis da <strong>República Federativa do Brasil</strong>.</p>
          <p style={{ marginTop: '.5rem' }}><strong>Usuário Consumidor:</strong> competência do foro do domicílio do consumidor, nos termos do Art. 101, I, do CDC, ou, alternativamente, o foro eleito abaixo, a critério do consumidor.</p>
          <p style={{ marginTop: '.5rem' }}><strong>Usuário Empresarial:</strong> fica eleito o Foro da Comarca de <strong>Uberaba/MG</strong>, com renúncia expressa a qualquer outro, por mais privilegiado que seja.</p>
        </div>

        <h2><span className="sn">18 /</span> Contato</h2>
        <div className="box">
          <p>📧 Suporte: <a href="mailto:suporte@zapscript.me">suporte@zapscript.me</a></p>
          <p>🔒 Privacidade / LGPD: <a href="mailto:privacidade@zapscript.me">privacidade@zapscript.me</a></p>
          <p>👤 <strong>Encarregado de Dados (DPO):</strong> Roberto Frattari Tulio Silva — <a href="mailto:privacidade@zapscript.me">privacidade@zapscript.me</a></p>
          <p>🏢 <strong>Controlador:</strong> FOX TecnologIA LTDA — CNPJ 66.586.436/0001-12</p>
          <p>🌐 <a href="https://www.zapscript.me">zapscript.me</a></p>
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
