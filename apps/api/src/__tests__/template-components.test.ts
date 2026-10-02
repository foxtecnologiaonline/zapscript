/**
 * Componentes de template e HEADER DE MÍDIA (itens 4 e 8 do escopo
 * ZapScript × Twilio).
 *
 * O ponto destes testes: tudo que a Meta recusaria com um código opaco
 * (132000/132012/131009) no MEIO de um disparo tem que ser recusado ANTES,
 * com um erro nosso que diz o que falta.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  assertTemplateSendable, buildTemplateComponents, buildHeaderComponent,
  countTextVariables, templateBodyVarCount, templateHeaderFormat,
  templateHeaderVarCount, templateRequiresHeaderMedia, validateHeaderMedia,
  type MetaTemplateLike,
} from '../services/template-components';
import { ApiError } from '../lib/apiErrors';

const templateTexto: MetaTemplateLike = {
  name: 'promo_verao', status: 'APPROVED',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Oferta de {{1}}' },
    { type: 'BODY',   text: 'Olá {{1}}, seu pedido {{2}} está pronto, {{1}}!' },
    { type: 'FOOTER', text: 'Responda PARAR para sair' },
  ],
};

const templateImagem: MetaTemplateLike = {
  name: 'promo_imagem', status: 'APPROVED',
  components: [
    { type: 'HEADER', format: 'IMAGE' },
    { type: 'BODY',   text: 'Confira a novidade!' },
  ],
};

const templateDoc: MetaTemplateLike = {
  name: 'boleto', status: 'APPROVED',
  components: [
    { type: 'HEADER', format: 'DOCUMENT' },
    { type: 'BODY',   text: 'Seu boleto de {{1}} venceu.' },
  ],
};

describe('leitura da definição do template', () => {
  it('conta variáveis DISTINTAS, não ocorrências', () => {
    // "{{1}} ... {{2}} ... {{1}}" espera 2 parâmetros. Contar ocorrências
    // pediria 3 e a Meta responderia 132000.
    expect(countTextVariables('Olá {{1}}, pedido {{2}} pronto, {{1}}!')).toBe(2);
    expect(countTextVariables('sem variável')).toBe(0);
    expect(countTextVariables(null)).toBe(0);
    expect(countTextVariables('espaços {{ 1 }} contam')).toBe(1);
    expect(templateBodyVarCount(templateTexto)).toBe(2);
  });

  it('identifica o formato do header', () => {
    expect(templateHeaderFormat(templateTexto)).toBe('TEXT');
    expect(templateHeaderFormat(templateImagem)).toBe('IMAGE');
    expect(templateHeaderFormat(templateDoc)).toBe('DOCUMENT');
    expect(templateHeaderFormat({ name: 'x', components: [{ type: 'BODY', text: 'oi' }] })).toBe('NONE');
    expect(templateHeaderFormat(null)).toBe('NONE');
  });

  it('só exige mídia em header image/video/document', () => {
    expect(templateRequiresHeaderMedia(templateImagem)).toBe(true);
    expect(templateRequiresHeaderMedia(templateDoc)).toBe(true);
    expect(templateRequiresHeaderMedia(templateTexto)).toBe(false);
  });

  it('conta variável de header só quando o header é de texto', () => {
    expect(templateHeaderVarCount(templateTexto)).toBe(1);
    expect(templateHeaderVarCount(templateImagem)).toBe(0);
  });
});

describe('validateHeaderMedia', () => {
  const expectCode = (fn: () => void, code: string) => {
    try {
      fn();
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe(code);
    }
  };

  it('aceita URL HTTPS com extensão compatível', () => {
    expect(() => validateHeaderMedia({ type: 'image', link: 'https://cdn.x.com/a.jpg' })).not.toThrow();
    expect(() => validateHeaderMedia({ type: 'video', link: 'https://cdn.x.com/a.mp4' })).not.toThrow();
    expect(() => validateHeaderMedia({ type: 'document', link: 'https://cdn.x.com/a.pdf', filename: 'Boleto.pdf' })).not.toThrow();
  });

  it('aceita media id da Meta sem link', () => {
    expect(() => validateHeaderMedia({ type: 'image', id: '1234567890' })).not.toThrow();
  });

  it('recusa http:// — a Meta não baixa de endereço sem TLS', () => {
    expectCode(() => validateHeaderMedia({ type: 'image', link: 'http://cdn.x.com/a.jpg' }), 'message.media_url_invalid');
  });

  it('recusa extensão que não casa com o tipo', () => {
    expectCode(() => validateHeaderMedia({ type: 'image', link: 'https://cdn.x.com/a.pdf' }), 'message.media_url_invalid');
    expectCode(() => validateHeaderMedia({ type: 'document', link: 'https://cdn.x.com/a.png', filename: 'x.png' }), 'message.media_url_invalid');
  });

  it('aceita URL sem extensão (link assinado de CDN)', () => {
    // Quem decide é o Content-Type que a Meta vai ler — não temos como saber aqui.
    expect(() => validateHeaderMedia({ type: 'image', link: 'https://cdn.x.com/download?id=abc' })).not.toThrow();
  });

  it('recusa documento sem filename', () => {
    // Sem filename o WhatsApp exibe a URL inteira como nome do arquivo.
    expectCode(() => validateHeaderMedia({ type: 'document', link: 'https://cdn.x.com/a.pdf' }), 'request.invalid');
  });

  it('recusa tipo de header inválido e ausência de link/id', () => {
    expectCode(() => validateHeaderMedia({ type: 'audio' as any, link: 'https://x/a.mp3' }), 'template.header_media_unsupported');
    expectCode(() => validateHeaderMedia({ type: 'image' }), 'message.media_url_invalid');
  });
});

describe('buildTemplateComponents', () => {
  it('monta header de mídia no formato da Graph API', () => {
    expect(buildHeaderComponent({ type: 'image', link: 'https://cdn.x.com/a.jpg' })).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { link: 'https://cdn.x.com/a.jpg' } }],
    });
    expect(buildHeaderComponent({ type: 'document', link: 'https://cdn.x.com/a.pdf', filename: 'Boleto.pdf' })).toEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { link: 'https://cdn.x.com/a.pdf', filename: 'Boleto.pdf' } }],
    });
    expect(buildHeaderComponent({ type: 'image', id: '999' })).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { id: '999' } }],
    });
  });

  it('monta body com as variáveis posicionais', () => {
    const out = buildTemplateComponents({ bodyVariables: ['João', 42] });
    expect(out).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'João' }, { type: 'text', text: '42' }] },
    ]);
  });

  it('header informado SOBREPÕE header estático salvo na campanha', () => {
    // O rascunho da campanha pode ter um header antigo gravado; quem manda é o
    // que o chamador informou agora.
    const out = buildTemplateComponents({
      header: { type: 'image', link: 'https://cdn.x.com/novo.jpg' },
      staticComponents: [
        { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.x.com/velho.jpg' } }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc' }] },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].parameters[0].image.link).toBe('https://cdn.x.com/novo.jpg');
    // Componentes de outro tipo seguem preservados.
    expect(out[1].type).toBe('button');
  });

  it('sem header e sem variáveis devolve só os estáticos', () => {
    expect(buildTemplateComponents({ staticComponents: [{ type: 'footer' }] })).toEqual([{ type: 'footer' }]);
    expect(buildTemplateComponents({})).toEqual([]);
  });
});

describe('assertTemplateSendable', () => {
  const expectCode = (fn: () => void, code: string) => {
    try {
      fn();
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe(code);
    }
  };

  it('passa quando variáveis e header casam com o aprovado', () => {
    expect(() => assertTemplateSendable({ template: templateTexto, bodyVariables: ['a', 'b'] })).not.toThrow();
    expect(() => assertTemplateSendable({
      template: templateImagem,
      header: { type: 'image', link: 'https://cdn.x.com/a.png' },
    })).not.toThrow();
  });

  it('recusa template inexistente e não aprovado', () => {
    expectCode(() => assertTemplateSendable({ template: null }), 'template.not_found');
    expectCode(
      () => assertTemplateSendable({ template: { ...templateImagem, status: 'PENDING' }, header: { type: 'image', link: 'https://x/a.png' } }),
      'template.not_approved',
    );
    expectCode(
      () => assertTemplateSendable({ template: { ...templateImagem, status: 'PAUSED' }, header: { type: 'image', link: 'https://x/a.png' } }),
      'template.not_approved',
    );
  });

  it('exige header de mídia quando o template tem um', () => {
    expectCode(() => assertTemplateSendable({ template: templateImagem }), 'template.header_media_required');
  });

  it('recusa header de mídia em template que não tem header de mídia', () => {
    expectCode(
      () => assertTemplateSendable({ template: templateTexto, bodyVariables: ['a', 'b'], header: { type: 'image', link: 'https://x/a.png' } }),
      'template.header_media_unsupported',
    );
  });

  it('recusa header do tipo errado (manda imagem num header de documento)', () => {
    expectCode(
      () => assertTemplateSendable({ template: templateDoc, bodyVariables: ['hoje'], header: { type: 'image', link: 'https://x/a.png' } }),
      'template.header_media_unsupported',
    );
  });

  it('recusa número de variáveis diferente do aprovado, dizendo quantas faltam', () => {
    try {
      assertTemplateSendable({ template: templateTexto, bodyVariables: ['só uma'] });
      throw new Error('deveria ter lançado');
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('template.param_mismatch');
      expect(apiErr.details).toEqual({ expected: 2, received: 1 });
      expect(apiErr.message).toContain('espera 2');
    }
  });

  it('recusa variáveis enviadas para template sem variável', () => {
    expectCode(
      () => assertTemplateSendable({
        template: templateImagem,
        header: { type: 'image', link: 'https://x/a.png' },
        bodyVariables: ['sobrando'],
      }),
      'template.param_mismatch',
    );
  });
});

describe('cópia no worker', () => {
  it('é byte a byte idêntica à da API', () => {
    const api    = readFileSync(join(__dirname, '../services/template-components.ts'), 'utf8');
    const worker = readFileSync(join(__dirname, '../../../worker/src/services/template-components.ts'), 'utf8');
    expect(worker).toBe(api);
  });
});
