import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Regulamento do Programa de Afiliados — ZapScript',
  description: 'Regulamento completo do Programa de Afiliados (carteira de crédito) do ZapScript. Versão 4, vigente.',
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
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
footer { text-align: center; padding: 2rem; border-top: 1px solid var(--border); font-family: 'Courier New',monospace; font-size: .7rem; color: var(--muted); }
.sn { font-family: 'Courier New',monospace; font-size: .68rem; color: #444; margin-right: .4rem; }
@media (max-width:600px) { main { padding: 2rem 1.25rem 4rem; } }
`;

export default function RegulamentoAfiliadosPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <header>
        <div className="logo">⚡ ZapScript</div>
        <h1>Regulamento do Programa de Afiliados</h1>
        <p className="meta">Versão 4 &nbsp;·&nbsp; Carteira de Crédito Interno &nbsp;·&nbsp; Aplica-se a todos os usuários</p>
      </header>

      <main>
        <div className="intro">
          Este regulamento rege o Programa de Afiliados do <strong>ZapScript</strong> (zapscript.me): a carteira de
          crédito interno, disponível automaticamente para qualquer usuário desde o cadastro, sem aplicação nem
          aprovação. A adesão ocorre no momento em que o link de indicação é gerado.
        </div>

        <h2><span className="sn">Art. 1º /</span> Definições</h2>
        <ul>
          <li><strong>Indicador:</strong> usuário que compartilha seu link de indicação.</li>
          <li><strong>Indicado:</strong> usuário cadastrado através desse link.</li>
          <li><strong>Crédito:</strong> unidade de valor interna; câmbio fixo <strong>1 crédito = R$ 1,00</strong>; sem valor de mercado; não transferível entre contas; não conversível por terceiros. Não constitui moeda eletrônica, valor mobiliário, criptoativo ou instrumento de pagamento regulado — é registro contábil de obrigação da ZapScript perante o usuário, extinguível apenas pelos usos previstos no Art. 5º.</li>
          <li><strong>Carteira:</strong> saldo de créditos vinculado à conta.</li>
        </ul>

        <h2><span className="sn">Art. 2º /</span> Elegibilidade</h2>
        <ul>
          <li>Toda conta ativa e com e-mail verificado recebe automaticamente link de indicação e carteira — sem aplicação, sem aprovação.</li>
          <li>Adesão ocorre no momento em que o link de indicação é gerado; este regulamento está acessível a partir desse mesmo momento.</li>
          <li>Saque em dinheiro exige CPF/CNPJ validado; demais trilhos não exigem.</li>
        </ul>

        <h2><span className="sn">Art. 3º /</span> Geração de crédito</h2>
        <ul>
          <li>Taxa única: <strong>20%</strong> do valor pago pelo indicado — mesma taxa para plano mensal e anual.</li>
          <li>Recorrente enquanto a assinatura do indicado permanecer ativa; apurada a cada cobrança (mês a mês, inclusive dentro de um ciclo anual).</li>
          <li>Sem tier por volume, sem residual — taxa fixa, sem degrau.</li>
        </ul>

        <h2><span className="sn">Art. 4º /</span> Liberação do crédito</h2>
        <ul>
          <li>Crédito é lançado na carteira do indicador <strong>30 dias após a confirmação do pagamento do indicado</strong>.</li>
          <li>Se o pagamento do indicado for cancelado/reembolsado dentro desses 30 dias, o crédito correspondente simplesmente não é gerado — não há estorno posterior de saldo já lançado.</li>
        </ul>

        <h2><span className="sn">Art. 5º /</span> Uso do saldo</h2>
        <ul>
          <li><strong>(a)</strong> Abater fatura (mensal/anual) do próprio indicador — tratado como desconto comercial.</li>
          <li><strong>(b)</strong> Comprar créditos avulsos do catálogo — tratado como desconto comercial.</li>
          <li><strong>(c)</strong> Sacar em dinheiro (Pix) — tratado como pagamento de comissão, sujeito a retenção na fonte e demais obrigações fiscais aplicáveis; valor mínimo de saque R$ 50.</li>
          <li>Câmbio único e fixo em qualquer trilho: 1 crédito = R$ 1,00. Uma vez lançado (Art. 4º), o saldo está disponível para qualquer um dos três trilhos, sem carência adicional.</li>
        </ul>
        <div className="warn-box">
          <p>Enquadramento fiscal de cada trilho sujeito a validação final por contador antes da abertura pública do trilho (c).</p>
        </div>

        <h2><span className="sn">Art. 6º /</span> Validade</h2>
        <ul>
          <li>Crédito não utilizado expira 12 meses após a geração.</li>
          <li>Aviso automático 30 e 7 dias antes da expiração.</li>
        </ul>

        <h2><span className="sn">Art. 7º /</span> Vedações e antifraude</h2>
        <ul>
          <li>Proibida autoindicação (mesmo CPF, mesmo meio de pagamento, mesmo dispositivo/IP recorrente).</li>
          <li>Proibida conta fictícia para gerar crédito.</li>
          <li>A chave Pix de saque deve pertencer ao CPF/CNPJ titular da própria conta.</li>
          <li>Infração: suspensão da conta, cancelamento dos créditos irregulares, bloqueio definitivo em reincidência.</li>
        </ul>

        <h2><span className="sn">Art. 8º /</span> Alterações</h2>
        <ul>
          <li>Taxas, carência e demais regras podem ser alteradas a qualquer momento, com aviso prévio de 30 dias.</li>
          <li>Alteração não afeta crédito já gerado antes da vigência.</li>
          <li>O usuário pode usar ou sacar o saldo acumulado antes da alteração entrar em vigor, e pode encerrar sua participação no programa a qualquer momento, sem penalidade.</li>
        </ul>

        <h2><span className="sn">Art. 9º /</span> Proteção de dados</h2>
        <p>O tratamento de dados pessoais no âmbito deste programa (CPF, dados de chave Pix, histórico de indicações) segue a <a href="/privacidade">Política de Privacidade</a> vigente da ZapScript.</p>

        <h2><span className="sn">Art. 10 /</span> Disposições gerais</h2>
        <p>Não constitui vínculo empregatício, societário ou de representação comercial.</p>
        <div className="box">
          <p>Dúvidas sobre este regulamento: <a href="mailto:contato@zapscript.me">contato@zapscript.me</a>.</p>
        </div>
      </main>

      <footer>
        © {new Date().getFullYear()} ZapScript / FOX TecnologIA — <a href="/afiliados">Voltar ao Programa de Afiliados</a>
      </footer>
    </>
  );
}
