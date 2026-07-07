/**
 * Testes das regras de autonomia/escalação do Atende e da redação de PII.
 * Lógica pura — sem I/O, sem modelo.
 */
import { decideAutonomia, isSensitive, AtendeClassificacao } from '../services/atende-agent';
import { redactPII } from '../lib/pii';

function classif(over: Partial<AtendeClassificacao> = {}): AtendeClassificacao {
  return {
    categoria: 'duvida',
    urgencia: 'baixa',
    sentimento: 'neutro',
    confianca_resposta: 90,
    topicos_identificados: [],
    pendencias: [],
    ...over,
  };
}

describe('Atende — isSensitive', () => {
  it('piso jurídico/financeiro é sensível mesmo sem categorias do tenant', () => {
    expect(isSensitive(classif(), 'quero um reembolso agora', [])).toBe(true);
    expect(isSensitive(classif(), 'vou chamar meu advogado', [])).toBe(true);
    expect(isSensitive(classif(), 'vou no PROCON', [])).toBe(true);
  });

  it('categoria juridico/financeiro é sempre sensível', () => {
    expect(isSensitive(classif({ categoria: 'financeiro' }), 'oi tudo bem', [])).toBe(true);
    expect(isSensitive(classif({ categoria: 'juridico' }), 'oi', [])).toBe(true);
  });

  it('categoria sensível do tenant (cadastro livre) casa por acento/caixa', () => {
    expect(isSensitive(classif(), 'preciso falar sobre o CONTRATO', ['contrato'])).toBe(true);
    expect(isSensitive(classif(), 'qual o preço com desconto?', ['desconto'])).toBe(true);
    // termo detectado via tópico, não só na mensagem
    expect(isSensitive(classif({ topicos_identificados: ['reajuste anual'] }), 'oi', ['reajuste'])).toBe(true);
  });

  it('mensagem comum sem gatilho não é sensível', () => {
    expect(isSensitive(classif(), 'qual o horário de funcionamento?', ['contrato'])).toBe(false);
  });
});

describe('Atende — decideAutonomia', () => {
  it('caso verde: alta confiança, não sensível, sem escalação', () => {
    const d = decideAutonomia(classif(), 'qual o horário de vocês?', []);
    expect(d).toEqual({ spam: false, sensivel: false, requerEscalacao: false });
  });

  it('categoria sensível SEMPRE escala (nunca verde)', () => {
    const d = decideAutonomia(classif({ confianca_resposta: 99 }), 'quero cancelar o contrato', ['contrato']);
    expect(d.sensivel).toBe(true);
    expect(d.requerEscalacao).toBe(true);
  });

  it('confiança baixa escala mesmo sem sensibilidade', () => {
    const d = decideAutonomia(classif({ confianca_resposta: 40 }), 'pergunta qualquer', []);
    expect(d.sensivel).toBe(false);
    expect(d.requerEscalacao).toBe(true);
  });

  it('cliente frustrado + urgência alta escala', () => {
    const d = decideAutonomia(classif({ sentimento: 'frustrado', urgencia: 'alta' }), 'isso é um absurdo', []);
    expect(d.requerEscalacao).toBe(true);
  });

  it('spam é sinalizado', () => {
    const d = decideAutonomia(classif({ categoria: 'spam' }), 'ganhe R$1000 clique aqui', []);
    expect(d.spam).toBe(true);
  });
});

describe('LGPD — redactPII', () => {
  it('mascara e-mail, telefone e CPF/CNPJ', () => {
    const out = redactPII('meu email é joao@ex.com, tel (11) 98888-7777, cpf 123.456.789-00');
    expect(out).not.toContain('joao@ex.com');
    expect(out).not.toContain('98888-7777');
    expect(out).not.toContain('123.456.789-00');
    expect(out).toContain('[email]');
    expect(out).toContain('[telefone]');
    expect(out).toContain('[documento]');
  });

  it('texto sem PII permanece', () => {
    expect(redactPII('agendamento confirmado para amanhã')).toBe('agendamento confirmado para amanhã');
  });

  it('nulo/vazio vira string vazia', () => {
    expect(redactPII(null)).toBe('');
    expect(redactPII(undefined)).toBe('');
  });
});
