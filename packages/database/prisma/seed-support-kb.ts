import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Base de conhecimento inicial do Agente de Suporte.
 * Rode com: cd packages/database && npx ts-node --project tsconfig.json prisma/seed-support-kb.ts
 * Idempotente: pula tópicos cujo título já existe.
 */
const TOPICOS = [
  {
    titulo: 'O que é o ZapScript',
    categoria: 'duvida_produto',
    tags: ['produto', 'transcricao', 'audio'],
    conteudo:
      'O ZapScript.me transcreve e resume automaticamente os áudios do WhatsApp usando IA. ' +
      'Você conecta seu número, e os áudios recebidos viram texto e resumo em segundos — sem precisar ouvir.',
  },
  {
    titulo: 'Planos e limites de minutos',
    categoria: 'upgrade_plano',
    tags: ['plano', 'preco', 'minutos', 'free', 'pro'],
    conteudo:
      'Plano Free: R$0, 20 minutos/mês, 1 número. Plano Pro: R$29,90/mês, mais minutos e 2 números. ' +
      'Os minutos renovam mensalmente. Minutos extras de indicação/avulsos valem 60 dias. ' +
      'Não confirme valores fora desta base — em dúvida, escale para um humano.',
  },
  {
    titulo: 'Como conectar meu número do WhatsApp',
    categoria: 'problema_tecnico',
    tags: ['conexao', 'qrcode', 'numero', 'whatsapp'],
    conteudo:
      'No painel, vá em "Números" e clique em conectar. Um QR Code aparece — abra o WhatsApp no celular, ' +
      'vá em Aparelhos conectados > Conectar um aparelho e escaneie o QR. A conexão é confirmada automaticamente.',
  },
  {
    titulo: 'A transcrição parou de funcionar',
    categoria: 'problema_tecnico',
    tags: ['erro', 'transcricao', 'parou', 'nao funciona'],
    conteudo:
      'Passos: 1) confira em "Números" se o status está "conectado"; se estiver desconectado, reconecte pelo QR Code. ' +
      '2) verifique se ainda há minutos disponíveis no seu plano. 3) confirme que o áudio foi recebido no número conectado. ' +
      'Se mesmo assim não funcionar, escale para o suporte humano com o horário aproximado do áudio.',
  },
  {
    titulo: 'Cobrança, reembolso e cancelamento',
    categoria: 'cobranca',
    tags: ['cobranca', 'reembolso', 'cancelar', 'pagamento', 'asaas'],
    conteudo:
      'Pagamentos via Asaas (PIX ou cartão). Qualquer pedido de reembolso, contestação de cobrança ou cancelamento ' +
      'deve ser SEMPRE escalado para um humano — o agente não processa reembolsos nem cancela assinaturas.',
  },
  {
    titulo: 'Privacidade e LGPD',
    categoria: 'duvida_produto',
    tags: ['privacidade', 'lgpd', 'dados', 'seguranca'],
    conteudo:
      'Os dados são isolados por usuário e dados sensíveis são criptografados. O usuário pode exportar ou solicitar ' +
      'exclusão dos seus dados pelo painel. Detalhes na Política de Privacidade em zapscript.me/privacidade.',
  },
];

async function main() {
  console.log('🌱 Semeando base de conhecimento do suporte...');
  let criados = 0;
  for (const t of TOPICOS) {
    const existe = await prisma.knowledgeBase.findFirst({ where: { titulo: t.titulo } });
    if (existe) { console.log(`  • já existe: ${t.titulo}`); continue; }
    await prisma.knowledgeBase.create({
      data: { titulo: t.titulo, conteudo: t.conteudo, categoria: t.categoria, tags: t.tags, aprovadoPorAdmin: true },
    });
    criados++;
    console.log(`  ✓ criado: ${t.titulo}`);
  }
  console.log(`✅ Concluído. ${criados} tópico(s) novo(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
