export interface NicheTemplate {
  key: string;
  label: string;
  businessContext: string;
  kb: { question: string; answer: string }[];
}

// Ponto de partida por segmento — o dono ajusta os detalhes (nome, horário, preços reais)
// antes de salvar. Cobre os segmentos mais comuns entre quem já usa o ZapScript.
export const NICHE_TEMPLATES: NicheTemplate[] = [
  {
    key: 'odontologia',
    label: 'Clínica odontológica',
    businessContext:
      'Somos uma clínica odontológica. Atendemos de segunda a sábado, das 8h às 18h. ' +
      'Oferecemos consultas, limpeza, clareamento, restauração e ortodontia. Aceitamos ' +
      'PIX, cartão e os principais convênios odontológicos. Agendamentos são feitos por ' +
      'aqui mesmo no WhatsApp, com confirmação no dia anterior.',
    kb: [
      { question: 'Vocês atendem por convênio?', answer: 'Sim, aceitamos os principais convênios odontológicos. Me conta qual é o seu que eu confirmo a cobertura.' },
      { question: 'Quanto custa uma limpeza?', answer: 'O valor varia conforme a avaliação. Consigo agendar uma consulta de avaliação pra te passar o valor certinho?' },
      { question: 'Como faço para marcar uma consulta?', answer: 'Posso agendar por aqui mesmo. Qual o melhor dia e período (manhã ou tarde) pra você?' },
      { question: 'Vocês fazem clareamento dental?', answer: 'Sim, fazemos clareamento a laser e também de moldeira. Quer que eu agende uma avaliação?' },
    ],
  },
  {
    key: 'advocacia',
    label: 'Escritório de advocacia',
    businessContext:
      'Somos um escritório de advocacia. Atendemos de segunda a sexta, das 9h às 18h, ' +
      'com atendimento inicial gratuito para entender o caso. Atuamos principalmente nas ' +
      'áreas cível, trabalhista e de família. Consultas são preferencialmente agendadas, ' +
      'presenciais ou por videochamada.',
    kb: [
      { question: 'A primeira consulta é paga?', answer: 'Não, a primeira conversa pra entender seu caso é gratuita. Me conta rapidamente o que está acontecendo?' },
      { question: 'Vocês atuam com causa trabalhista?', answer: 'Sim, atuamos com direito trabalhista. Pode me contar um pouco da sua situação que eu já direciono pro advogado responsável?' },
      { question: 'Quanto custa contratar vocês?', answer: 'Depende do tipo de caso e da complexidade — isso é definido na consulta inicial, que é gratuita. Quer agendar?' },
      { question: 'Posso fazer a consulta por vídeo?', answer: 'Sim, atendemos presencial ou por videochamada, como for melhor pra você.' },
    ],
  },
  {
    key: 'salao-beleza',
    label: 'Salão de beleza / estética',
    businessContext:
      'Somos um salão de beleza e estética. Atendemos de terça a sábado, das 9h às 19h. ' +
      'Trabalhamos com corte, coloração, escova, manicure, pedicure e procedimentos ' +
      'estéticos faciais. Aceitamos PIX, cartão e dinheiro. Agendamento por horário marcado.',
    kb: [
      { question: 'Qual o valor da escova?', answer: 'O valor varia conforme o comprimento e tipo de cabelo. Consigo te passar certinho, me diz seu nome que já confirmo horário?' },
      { question: 'Vocês fazem unha em gel?', answer: 'Sim, trabalhamos com unha em gel e também esmaltação tradicional. Quer agendar um horário?' },
      { question: 'Preciso agendar com antecedência?', answer: 'É sempre bom garantir seu horário com antecedência, principalmente fim de semana. Qual dia fica melhor pra você?' },
      { question: 'Vocês atendem sem hora marcada?', answer: 'Trabalhamos por horário marcado pra garantir um bom atendimento. Posso já ver um horário disponível pra você?' },
    ],
  },
  {
    key: 'petshop',
    label: 'Petshop / banho e tosa',
    businessContext:
      'Somos um petshop com serviços de banho, tosa e venda de produtos para pets. ' +
      'Atendemos de segunda a sábado, das 8h às 18h. Fazemos busca e entrega do pet em ' +
      'alguns bairros. Aceitamos PIX, cartão e dinheiro.',
    kb: [
      { question: 'Quanto custa o banho e tosa?', answer: 'O valor depende do porte e raça do pet. Me conta qual é o seu peludo que eu já te passo o valor certinho?' },
      { question: 'Vocês buscam o pet em casa?', answer: 'Sim, fazemos busca e entrega em alguns bairros. Me passa seu endereço que confirmo se atendemos sua região.' },
      { question: 'Precisa levar a carteira de vacinação?', answer: 'Sim, pedimos a carteirinha de vacinação em dia pra garantir a segurança de todos os pets.' },
      { question: 'Vocês vendem ração?', answer: 'Sim, temos várias marcas de ração e produtos. Qual porte e idade do seu pet pra eu indicar a melhor opção?' },
    ],
  },
  {
    key: 'restaurante',
    label: 'Restaurante / delivery',
    businessContext:
      'Somos um restaurante com atendimento no local e delivery. Funcionamos de terça a ' +
      'domingo, das 11h30 às 15h e das 18h às 22h30. Pedidos pelo WhatsApp, aceitamos ' +
      'PIX, cartão e dinheiro. Fazemos entrega em bairros próximos com taxa variável ' +
      'conforme a distância.',
    kb: [
      { question: 'Qual a taxa de entrega?', answer: 'A taxa varia conforme o bairro. Me passa seu endereço que já calculo certinho pra você.' },
      { question: 'Vocês têm opção vegetariana?', answer: 'Sim, temos opções vegetarianas no cardápio. Quer que eu te mande o cardápio completo?' },
      { question: 'Qual o tempo de entrega?', answer: 'O tempo médio de entrega é de 40 a 60 minutos, dependendo do movimento e da distância. Já quer fazer o pedido?' },
      { question: 'Vocês estão abertos agora?', answer: 'Funcionamos de terça a domingo, das 11h30 às 15h e das 18h às 22h30. Quer já fazer seu pedido?' },
    ],
  },
  {
    key: 'academia',
    label: 'Academia / estúdio fitness',
    businessContext:
      'Somos uma academia / estúdio fitness. Funcionamos de segunda a sexta, das 6h às ' +
      '22h, e aos sábados das 8h às 12h. Oferecemos musculação, aulas coletivas e ' +
      'acompanhamento de personal trainer. Trabalhamos com planos mensais, trimestrais ' +
      'e anuais, além de aula avulsa.',
    kb: [
      { question: 'Quanto custa a mensalidade?', answer: 'Temos planos mensais, trimestrais e anuais com valores diferentes. Quer que eu te explique as opções?' },
      { question: 'Vocês têm aula experimental?', answer: 'Sim, oferecemos uma aula experimental gratuita. Quer agendar pra conhecer o espaço?' },
      { question: 'Tem horário de aula de manhã cedo?', answer: 'Sim, temos turmas a partir das 6h. Qual modalidade você tem interesse?' },
      { question: 'Preciso de atestado médico?', answer: 'Recomendamos um atestado de aptidão física, mas você já pode conhecer o espaço e começar o cadastro.' },
    ],
  },
];
