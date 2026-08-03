/**
 * Mapa de interlinking entre posts do blog.
 *
 * Cada entrada mapeia um slug → lista de slugs de posts relacionados.
 * Esses links são exibidos DENTRO do conteúdo de cada post (não só no
 * bloco "Leia também" do final), usando a tag [[slug]] no HTML do post.
 *
 * Critérios de relacionamento:
 * - Mesma categoria (cluster temático)
 * - Palavras-chave sobrepostas
 * - Posts que respondem perguntas complementares
 *
 * O componente BlogPostContent (client-side) substitui [[slug]] por um
 * <Link> inline para o post referenciado.
 */
const INTERLINK_MAP: Record<string, string[]> = {
  'como-transcrever-audio-whatsapp': [
    'melhor-app-transcrever-audio-whatsapp-2026',
    'resumo-audio-whatsapp-ia',
    'quanto-custa-transcrever-audio-whatsapp',
  ],
  'resumo-audio-whatsapp-ia': [
    'como-transcrever-audio-whatsapp',
    'modo-privado-whatsapp-transcricao',
    'cansei-de-ouvir-audio-longo-no-whatsapp',
  ],
  'modo-privado-whatsapp-transcricao': [
    'resumo-audio-whatsapp-ia',
    'transcricao-de-audio-com-ia-e-segura',
    'como-transcrever-audio-whatsapp',
  ],
  'transcricao-audio-whatsapp-empresas': [
    'melhor-app-transcrever-audio-whatsapp-2026',
    'transcricao-audio-whatsapp-atendimento-ao-cliente',
    'quanto-custa-transcrever-audio-whatsapp',
  ],
  'melhor-app-transcrever-audio-whatsapp-2026': [
    'transcrever-audio-whatsapp-gratis-vs-pago',
    'como-transcrever-audio-whatsapp',
    'quanto-custa-transcrever-audio-whatsapp',
  ],
  'cansei-de-ouvir-audio-longo-no-whatsapp': [
    'resumo-audio-whatsapp-ia',
    'modo-privado-whatsapp-transcricao',
    'converter-audio-em-texto',
  ],
  'transcrever-audio-whatsapp-gratis-vs-pago': [
    'quanto-custa-transcrever-audio-whatsapp',
    'melhor-app-transcrever-audio-whatsapp-2026',
    'como-transcrever-audio-whatsapp',
  ],
  'transcricao-de-audio-com-ia-e-segura': [
    'modo-privado-whatsapp-transcricao',
    'transcricao-audio-whatsapp-empresas',
  ],
  'converter-audio-em-texto': [
    'transcrever-audio-para-texto-online',
    'como-transcrever-audio-whatsapp',
    'resumo-audio-whatsapp-ia',
  ],
  'transcrever-audio-para-texto-online': [
    'converter-audio-em-texto',
    'como-transcrever-audio-whatsapp',
  ],
  'casos-reais-transcricao-audio-whatsapp': [
    'resumo-audio-whatsapp-ia',
    'transcricao-audio-whatsapp-empresas',
    'cansei-de-ouvir-audio-longo-no-whatsapp',
  ],
  'transcrever-audio-whatsapp-advogados': [
    'transcricao-de-audio-com-ia-e-segura',
    'modo-privado-whatsapp-transcricao',
    'transcricao-audio-whatsapp-empresas',
  ],
  'transcrever-audio-whatsapp-corretores': [
    'transcrever-audio-whatsapp-vendas',
    'transcricao-audio-whatsapp-empresas',
    'transcrever-audio-whatsapp-gratis-vs-pago',
  ],
  'transcrever-audio-whatsapp-vendas': [
    'transcrever-audio-whatsapp-corretores',
    'transcricao-audio-whatsapp-empresas',
    'transcricao-audio-whatsapp-vendedor-autonomo',
  ],
  'transcrever-audio-whatsapp-iphone': [
    'transcrever-audio-whatsapp-android',
    'transcrever-audio-whatsapp-pc',
    'como-transcrever-audio-whatsapp',
  ],
  'transcrever-audio-whatsapp-android': [
    'transcrever-audio-whatsapp-iphone',
    'transcrever-audio-whatsapp-pc',
    'como-transcrever-audio-whatsapp',
  ],
  'transcrever-audio-whatsapp-pc': [
    'transcrever-audio-whatsapp-iphone',
    'transcrever-audio-whatsapp-android',
    'como-transcrever-audio-whatsapp',
  ],
  'transcricao-audio-whatsapp-psicologos': [
    'transcricao-de-audio-com-ia-e-segura',
    'modo-privado-whatsapp-transcricao',
    'transcrever-audio-whatsapp-advogados',
  ],
  'transcricao-audio-whatsapp-vendedor-autonomo': [
    'transcrever-audio-whatsapp-vendas',
    'transcrever-audio-whatsapp-gratis-vs-pago',
    'casos-reais-transcricao-audio-whatsapp',
  ],
  'transcricao-audio-whatsapp-clinica-odontologica': [
    'transcricao-de-audio-com-ia-e-segura',
    'modo-privado-whatsapp-transcricao',
    'transcricao-audio-whatsapp-atendimento-ao-cliente',
  ],
  'transcricao-audio-whatsapp-corretor-autonomo': [
    'transcrever-audio-whatsapp-corretores',
    'transcricao-audio-whatsapp-vendedor-autonomo',
    'transcrever-audio-whatsapp-vendas',
  ],
  'quanto-custa-transcrever-audio-whatsapp': [
    'transcrever-audio-whatsapp-gratis-vs-pago',
    'melhor-app-transcrever-audio-whatsapp-2026',
    'transcricao-audio-whatsapp-empresas',
  ],
  'transcricao-audio-whatsapp-atendimento-ao-cliente': [
    'transcricao-audio-whatsapp-empresas',
    'transcricao-de-audio-com-ia-e-segura',
  ],
};

export default INTERLINK_MAP;
