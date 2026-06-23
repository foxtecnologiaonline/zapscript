// Depoimentos reais de usuários do ZapScript.
// COMO ADICIONAR: preencha o array abaixo conforme os depoimentos chegam.
// O componente <Testimonials> só aparece no site quando há ao menos 1 item —
// enquanto vazio, nada é renderizado (evita prova social falsa/placeholder).

export type Testimonial = {
  quote: string;       // o depoimento, idealmente 1–3 frases
  name: string;        // nome de quem deu o depoimento
  role?: string;       // profissão/cargo (ex: "Corretora de imóveis")
  avatar?: string;     // URL opcional de foto (quadrada). Sem foto, usa as iniciais.
};

export const TESTIMONIALS: Testimonial[] = [
  // Exemplo (remova ao adicionar reais):
  // {
  //   quote: 'Recebo dezenas de áudios por dia. Agora leio tudo em segundos — virou meu robô particular.',
  //   name: 'Mariana S.',
  //   role: 'Corretora de imóveis',
  // },
];
