process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import { isValidCnpj, isValidCpf, phrase, pickPrompt, simulateIvr, validateIvrDefinition, type IvrDefinition, type IvrEnv } from '../ivr';

/** Motor da URA sem telefonia: edital 1.1.3.1.6.1 — cut-thru, force-play, echo, múltiplos idiomas, validação do grafo. */
const BH = { mon: [['08:00', '18:00']], tue: [['08:00', '18:00']], wed: [['08:00', '18:00']], thu: [['08:00', '18:00']], fri: [['08:00', '18:00']] };
const ENV = (at = '2026-03-10T15:00:00Z', holidays: string[] = []): IvrEnv => ({
  now: () => new Date(at), settings: { timezone: 'America/Sao_Paulo', businessHours: BH as any }, holidays: new Set(holidays),
});

const DEF: IvrDefinition = {
  start: 'lang', dids: ['08001234567'], defaultLang: 'pt-BR',
  entryByHeader: { header: 'X-URA-Option', map: { '9': 'proc' } },
  nodes: {
    lang: { type: 'language', prompt: { text: 'Para português, 1. For English, 2.' }, languages: { '1': 'pt-BR', '2': 'en' }, next: 'aviso' },
    aviso: { type: 'play', prompt: { text: 'Aviso obrigatório.', i18n: { en: { text: 'Mandatory notice.' } } }, forcePlay: true, next: 'menu' },
    menu: {
      type: 'menu', prompt: { text: 'Digite 1 para processos, 2 para CPF, 3 para horário.', i18n: { en: { text: 'Press 1 for cases.' } } },
      options: { '1': 'proc', '2': 'cpf', '3': 'sched' }, maxRetries: 1, timeoutSec: 3,
    },
    proc: { type: 'collect', prompt: { text: 'Digite o número do processo.' }, var: 'processo', minDigits: 3, maxDigits: 8, echo: true, confirm: true, next: 'fila' },
    cpf: { type: 'collect', prompt: { text: 'Digite o CPF.' }, var: 'cpf', minDigits: 11, maxDigits: 11, validate: 'cpf', maxRetries: 1, next: 'fila', timeoutNode: 'bye' },
    sched: { type: 'schedule', open: 'fila', closed: 'bye', holiday: 'feriado' },
    feriado: { type: 'hangup', prompt: { text: 'Feriado.' } },
    fila: { type: 'queue', category: 'PROCESSO', queue: 'atendimento', priority: 2 },
    bye: { type: 'hangup', prompt: { text: 'Até logo.' } },
  },
};

describe('URA — validação da árvore', () => {
  it('aceita um fluxo bem formado e devolve a definição', () => {
    const v = validateIvrDefinition(DEF);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.definition?.start).toBe('lang');
  });

  it('rejeita nó inexistente, início ausente, fluxo sem fila e ciclo sem saída', () => {
    const bad = { start: 'a', nodes: { a: { type: 'play', prompt: { text: 'x' }, next: 'b' }, b: { type: 'play', prompt: { text: 'y' }, next: 'a' } } };
    const v = validateIvrDefinition(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['ivr.no_queue']));
    expect(validateIvrDefinition({ start: 'z', nodes: { q: { type: 'queue' } } }).errors.map((e) => e.code)).toContain('ivr.start_missing');
    expect(validateIvrDefinition({ start: 'q', nodes: { q: { type: 'menu', prompt: { text: 'x' }, options: { '1': 'nada' } } } }).errors.map((e) => e.code)).toContain('ivr.node_missing');
    const loop = { start: 'm', nodes: { m: { type: 'menu', prompt: { text: 'x' }, options: { '1': 'm', '2': 'p' } }, p: { type: 'play', prompt: { text: 'y' }, next: 'm' }, q: { type: 'queue' } } };
    const lv = validateIvrDefinition(loop);
    expect(lv.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['ivr.dead_end', 'ivr.queue_unreachable']));
    expect(lv.warnings.map((w) => w.code)).toContain('ivr.unreachable');
  });

  it('rejeita estrutura inválida (campo desconhecido, opção que não é dígito, prompt vazio)', () => {
    expect(validateIvrDefinition({ start: 'q', nodes: { q: { type: 'queue', foo: 1 } } }).errors[0].code).toBe('ivr.schema');
    expect(validateIvrDefinition({ start: 'm', nodes: { m: { type: 'menu', prompt: { text: 'x' }, options: { ab: 'm' } } } }).ok).toBe(false);
    expect(validateIvrDefinition({ start: 'p', nodes: { p: { type: 'play', prompt: {}, next: 'p' } } }).ok).toBe(false);
  });
});

describe('URA — execução (simulador)', () => {
  it('cut-thru: dígito durante o prompt escolhe a opção; force-play descarta o dígito digitado durante o aviso', async () => {
    // lang: "~1" durante o prompt → pt-BR · aviso (force-play): "~5" é descartado · menu: "~1" cut-thru → proc · coleta + confirma
    const r = await simulateIvr(DEF, ['~1', '~5', '~1', '1234#', '1'], ENV());
    expect(r.outcome).toMatchObject({ action: 'queue', node: 'fila', category: 'PROCESSO', priority: 2 });
    const aviso = r.spoken.find((s) => s.text === 'Aviso obrigatório.');
    expect(aviso?.interruptible).toBe(false);
    const menuChoice = r.trail.find((t) => t.node === 'menu' && t.event === 'choice');
    expect(menuChoice).toMatchObject({ input: '1', bargedIn: true, next: 'proc' });
    expect(r.vars.processo).toBe('1234');
    expect(r.unusedInputs).toEqual([]);
  });

  it('echo + confirmação: repete os dígitos e, se o chamador digita 2, pede de novo', async () => {
    // idioma "1" · menu "1" · coleta "111#" → confirma "2" (digitar de novo) · coleta "4321#" → confirma "1"
    const r = await simulateIvr(DEF, ['1', '1', '111#', '2', '4321#', '1'], ENV());
    expect(r.outcome).toMatchObject({ action: 'queue' });
    expect(r.vars.processo).toBe('4321');
    expect(r.spoken.filter((s) => s.text.startsWith('[dígitos')).length).toBe(2);
    expect(r.trail.some((t) => t.event === 'repeat' && t.result === 'not_confirmed')).toBe(true);
  });

  it('múltiplos idiomas: nó language troca o idioma e usa i18n nos prompts seguintes', async () => {
    const r = await simulateIvr(DEF, ['2', '1', '555#', '1'], ENV());
    expect(r.lang).toBe('en');
    expect(r.spoken.map((s) => s.text)).toEqual(expect.arrayContaining(['Mandatory notice.', 'Press 1 for cases.', 'You entered:']));
    expect(r.trail.find((t) => t.event === 'language')).toMatchObject({ result: 'en' });
  });

  it('CPF é dado sensível: valida dígitos, nunca entra em vars nem na trilha', async () => {
    const r = await simulateIvr(DEF, ['1', '2', '52998224725'], ENV());
    expect(r.sensitiveVars).toEqual(['cpf']);
    expect(r.vars).toEqual({});
    expect(JSON.stringify(r.trail)).not.toContain('52998224725');
    const collected = r.trail.find((t) => t.event === 'collected');
    expect(collected).toMatchObject({ sensitive: true, length: 11 });
    expect(collected).not.toHaveProperty('value');
  });

  it('CPF inválido esgota as tentativas e segue o timeoutNode/invalidNode ou encerra', async () => {
    const r = await simulateIvr(DEF, ['1', '2', '11111111111', '12345678901', '98765432100'], ENV());
    expect(r.trail.filter((t) => t.event === 'invalid').length).toBe(2);
    expect(r.outcome).toMatchObject({ action: 'hangup', node: 'bye' }); // exhausted → timeoutNode "bye"
  });

  it('tentativas esgotadas no menu sem destino de erro encerram com max_retries', async () => {
    const r = await simulateIvr(DEF, ['1', '', '', ''], ENV());
    expect(r.outcome).toMatchObject({ action: 'hangup', reason: 'max_retries', node: 'menu' });
    expect(r.spoken.some((s) => s.text.includes('Não foi possível concluir'))).toBe(true);
  });

  it('tecla * repete o menu sem contar tentativa', async () => {
    const r = await simulateIvr(DEF, ['1', '*', '*', '*', '1', '999#', '1'], ENV());
    expect(r.outcome.action).toBe('queue');
    expect(r.trail.filter((t) => t.event === 'repeat' && t.input === '*').length).toBe(3);
    expect(r.trail.some((t) => t.event === 'invalid')).toBe(false);
  });

  it('cabeçalho SIP da URA 0800 (entryByHeader) pula direto para o nó mapeado', async () => {
    const r = await simulateIvr(DEF, ['777#', '1'], ENV(), { headers: { 'x-ura-option': '9' } });
    expect(r.trail[0]).toMatchObject({ event: 'entry', node: 'proc', input: 'X-URA-Option=9' });
    expect(r.vars.processo).toBe('777');
    expect(r.outcome.action).toBe('queue');
  });

  it('schedule: aberto → fila; fora do horário → closed; feriado → ramo próprio', async () => {
    const open = await simulateIvr(DEF, ['1', '3'], ENV('2026-03-10T15:00:00Z'));
    expect(open.trail.find((t) => t.event === 'schedule')).toMatchObject({ result: 'open' });
    expect(open.outcome.action).toBe('queue');
    const closed = await simulateIvr(DEF, ['1', '3'], ENV('2026-03-10T05:00:00Z')); // 02:00 em Brasília
    expect(closed.trail.find((t) => t.event === 'schedule')).toMatchObject({ result: 'closed' });
    expect(closed.outcome).toMatchObject({ action: 'hangup', node: 'bye' });
    const hol = await simulateIvr(DEF, ['1', '3'], ENV('2026-03-10T15:00:00Z', ['2026-03-10']));
    expect(hol.trail.find((t) => t.event === 'schedule')).toMatchObject({ result: 'holiday' });
    expect(hol.outcome).toMatchObject({ action: 'hangup', node: 'feriado' });
  });

  it('entradas esgotadas = chamador desligou (aborted); nada é gravado como dado do cidadão', async () => {
    const r = await simulateIvr(DEF, ['1'], ENV());
    expect(r.outcome.action).toBe('aborted');
  });

  it('transferência para o tronco do TJTO devolve o destino para o controlador', async () => {
    const def: IvrDefinition = { start: 't', nodes: { t: { type: 'transfer', destination: { type: 'ura0800', number: '08006000000' } }, q: { type: 'queue' } } };
    const r = await simulateIvr(def, [], ENV());
    expect(r.outcome).toMatchObject({ action: 'transfer', destination: { type: 'ura0800', number: '08006000000' } });
  });
});

describe('URA — utilitários', () => {
  it('CPF/CNPJ', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
  });
  it('frases padrão por idioma e escolha de prompt', () => {
    expect(phrase('invalid', 'en').text).toBe('Invalid option.');
    expect(phrase('invalid', 'es-MX').text).toBe('Opción inválida.');
    expect(phrase('invalid', 'fr').text).toBe('Opção inválida.'); // idioma desconhecido → pt-BR
    expect(pickPrompt({ text: 'oi', i18n: { en: { text: 'hi' } } }, 'en-US').text).toBe('hi');
    expect(pickPrompt({ text: 'oi', audioKey: 'org/ivr/a.wav' }, 'pt-BR')).toMatchObject({ text: 'oi', audioKey: 'org/ivr/a.wav' });
  });
});
