import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Base de conhecimento inicial do Agente de Suporte.
 * Rode com: cd packages/database && npx ts-node --project tsconfig.json prisma/seed-support-kb.ts
 * Idempotente: pula tópicos cujo título já existe.
 */
const TOPICOS = [
  // ── PRODUTO E FUNCIONAMENTO ──────────────────────────────────────────────
  {
    titulo: 'O que é o ZapScript',
    categoria: 'duvida_produto',
    tags: ['produto', 'transcricao', 'audio', 'o que e', 'como funciona', 'ia'],
    conteudo:
      'O ZapScript.me transcreve e resume automaticamente os áudios do WhatsApp usando IA. ' +
      'Você conecta seu número como dispositivo adicional (igual ao WhatsApp Web), ' +
      'e todo áudio recebido vira texto e resumo em segundos — sem precisar ouvir. ' +
      'Funciona nos planos Free e Pro.',
  },
  {
    titulo: 'Planos e limites',
    categoria: 'upgrade_plano',
    tags: ['plano', 'preco', 'preco', 'audios', 'free', 'pro', 'limite', 'cota'],
    conteudo:
      'Plano Free: R$0, 15 áudios/mês, 1 número conectado. ' +
      'Plano Pro: R$18 no 1º mês (50% OFF de lançamento), depois R$37/mês; áudios ilimitados, 2 números. ' +
      'Cota renova mensalmente. ' +
      'Não confirme valores fora desta base — em dúvida, escale para um humano.',
  },
  {
    titulo: 'Oferta Pro: 50% OFF no primeiro mês',
    categoria: 'upgrade_plano',
    tags: ['desconto', 'oferta', 'promocao', 'preco', '50 off', 'primeiro mes', 'r$19', '19,90'],
    conteudo:
      'O plano Pro custa R$18 no primeiro mês (50% de desconto). A partir do 2º mês, o valor regular é R$37/mês. ' +
      'A oferta é permanente — não tem prazo de expiração. ' +
      'Para assinar, acesse o painel em /dashboard/plano e clique em "Assinar Pro". ' +
      'Pagamento por PIX ou cartão de crédito (via Asaas).',
  },
  {
    titulo: 'Trial de 7 dias com cartão',
    categoria: 'upgrade_plano',
    tags: ['trial', 'teste', '7 dias', 'cartao', 'gratis', 'experimentar', 'periodo'],
    conteudo:
      'Ao assinar o Pro com cartão de crédito, você tem 7 dias de trial gratuito. ' +
      'Se cancelar antes do 7º dia, não é cobrado nada. ' +
      'Após o trial, a cobrança do 1º mês (R$18) é feita automaticamente. ' +
      'Com PIX não há trial — o pagamento é imediato.',
  },
  {
    titulo: 'Como fazer upgrade Free → Pro',
    categoria: 'upgrade_plano',
    tags: ['upgrade', 'assinar', 'pro', 'como contratar', 'mudar plano', 'pagamento'],
    conteudo:
      'Passo a passo: 1) Faça login em zapscript.me. 2) Vá em Painel > Plano (ou /dashboard/plano). ' +
      '3) Clique em "Assinar Pro". 4) Escolha PIX ou cartão de crédito. 5) Siga as instruções de pagamento. ' +
      'Após a confirmação, os limites são atualizados em até 5 minutos. ' +
      'Em caso de dúvida no pagamento, escale para suporte humano.',
  },
  // ── CONEXÃO E NÚMEROS ───────────────────────────────────────────────────
  {
    titulo: 'Como conectar meu número do WhatsApp',
    categoria: 'problema_tecnico',
    tags: ['conexao', 'qrcode', 'qr', 'numero', 'whatsapp', 'conectar', 'vinculacao'],
    conteudo:
      'No painel, vá em "Números" e clique em conectar. Um QR Code aparece na tela. ' +
      'No celular: abra o WhatsApp > menu (três pontos) > Aparelhos conectados > Conectar um aparelho > escaneie o QR. ' +
      'A conexão é confirmada automaticamente em até 30 segundos. ' +
      'O QR Code expira em 60 segundos — se expirar, clique em "Gerar novo QR".',
  },
  {
    titulo: 'Número desconectado: causas e como reconectar',
    categoria: 'problema_tecnico',
    tags: ['desconectado', 'reconectar', 'qr', 'caiu', 'perdeu conexao', 'offline'],
    conteudo:
      'Causas comuns de desconexão: (1) WhatsApp no celular ficou sem internet por muito tempo; ' +
      '(2) você desconectou manualmente em "Aparelhos conectados"; ' +
      '(3) o WhatsApp foi atualizado no celular; (4) o número ficou inativo por mais de 14 dias. ' +
      'Para reconectar: Painel > Números > clique em "Reconectar" > escaneie o novo QR Code. ' +
      'Os áudios recebidos enquanto estava desconectado não são retroativos.',
  },
  {
    titulo: 'WhatsApp Business é compatível?',
    categoria: 'duvida_produto',
    tags: ['business', 'whatsapp business', 'conta comercial', 'empresa', 'cnpj'],
    conteudo:
      'Sim, o ZapScript funciona com WhatsApp Business da mesma forma que com o WhatsApp pessoal. ' +
      'A conexão é feita via dispositivo adicional (como WhatsApp Web), então funciona nos dois tipos de conta. ' +
      'Não é necessário nenhuma configuração especial para contas Business.',
  },
  // ── TRANSCRIÇÃO E FUNCIONAMENTO ─────────────────────────────────────────
  {
    titulo: 'A transcrição parou de funcionar',
    categoria: 'problema_tecnico',
    tags: ['erro', 'transcricao', 'parou', 'nao funciona', 'bug', 'nao converte'],
    conteudo:
      'Passos de diagnóstico: 1) Confira em "Números" se o status está "conectado" — se não, reconecte pelo QR. ' +
      '2) Verifique se ainda há áudios disponíveis no plano (cota esgotada = não converte). ' +
      '3) Confirme que o áudio foi recebido no número conectado (não no celular). ' +
      '4) Áudios com mais de 25MB não são suportados. ' +
      'Se nada resolver, escale informando: horário do áudio, número conectado e mensagem de erro, se houver.',
  },
  {
    titulo: 'Formatos de áudio suportados',
    categoria: 'duvida_produto',
    tags: ['formato', 'ogg', 'mp3', 'wav', 'm4a', 'tipo arquivo', 'extensao', 'tamanho'],
    conteudo:
      'Formatos suportados: OGG/OPUS (padrão do WhatsApp), MP3, MP4 (áudio), M4A, WAV, WebM, AAC, FLAC. ' +
      'Tamanho máximo: 25MB por arquivo. ' +
      'Duração prática: funciona muito bem em áudios de até 30 minutos. ' +
      'Áudios muito ruins de qualidade (muito ruído, vários falantes ao mesmo tempo) podem ter precisão reduzida.',
  },
  {
    titulo: 'Cota de áudios esgotada',
    categoria: 'upgrade_plano',
    tags: ['cota', 'limite', 'esgotou', 'acabou', 'nao converte mais', 'sem audios'],
    conteudo:
      'No plano Free, o limite é 15 áudios/mês. Ao esgotar: o ZapScript para de converter até o próximo ciclo. ' +
      'A cota renova automaticamente todo mês, na data de aniversário do cadastro. ' +
      'Para continuar convertendo imediatamente: assine o Pro (áudios ilimitados) em /dashboard/plano. ' +
      'Não é possível comprar créditos avulsos — apenas upgrade de plano.',
  },
  // ── COBRANÇA E PRIVACIDADE ───────────────────────────────────────────────
  {
    titulo: 'Cobrança, reembolso e cancelamento',
    categoria: 'cobranca',
    tags: ['cobranca', 'reembolso', 'cancelar', 'pagamento', 'asaas', 'pix', 'cartao'],
    conteudo:
      'Pagamentos via Asaas (PIX ou cartão de crédito). ' +
      'Qualquer pedido de reembolso, contestação de cobrança ou cancelamento DEVE ser escalado para humano — ' +
      'o agente não processa reembolsos nem cancela assinaturas. ' +
      'Para cancelar: o cliente pode acessar /dashboard/plano > Gerenciar Plano > Cancelar assinatura.',
  },
  {
    titulo: 'Privacidade e LGPD',
    categoria: 'duvida_produto',
    tags: ['privacidade', 'lgpd', 'dados', 'seguranca', 'audio armazenado', 'gdpr'],
    conteudo:
      'Privacidade por design: os áudios NUNCA são armazenados — são processados e descartados na hora. ' +
      'Transcrições são criptografadas e isoladas por usuário. ' +
      'Processamento via Whisper (OpenAI) e Claude (Anthropic), sem treinamento com dados do usuário. ' +
      'O usuário pode exportar ou solicitar exclusão dos dados pelo painel a qualquer momento. ' +
      'Detalhes: zapscript.me/privacidade.',
  },
  {
    titulo: 'Exportar ou excluir dados (LGPD)',
    categoria: 'duvida_produto',
    tags: ['exportar', 'excluir', 'deletar', 'lgpd', 'direito', 'meus dados', 'portabilidade'],
    conteudo:
      'Direitos LGPD: o usuário pode solicitar exportação ou exclusão dos dados a qualquer momento. ' +
      'Exportação: acesse o painel > Configurações > Exportar meus dados. ' +
      'Exclusão de conta: acesse o painel > Configurações > Excluir conta — ' +
      'isso remove permanentemente os dados do servidor. ' +
      'Para solicitações que não consiga fazer pelo painel, escale para suporte humano.',
  },
  // ── PROGRAMA DE INDICAÇÃO ────────────────────────────────────────────────
  {
    titulo: 'Programa de indicação (ganhe áudios grátis)',
    categoria: 'duvida_produto',
    tags: ['indicacao', 'referral', 'afiliado', 'link', 'amigo', 'ganhar', 'gratis', 'bonus'],
    conteudo:
      'O ZapScript tem programa de indicação: você ganha 5 áudios grátis para você e seu amigo indicado ' +
      'quando ele se cadastrar pelo seu link. ' +
      'Seu link pessoal está em Painel > Dashboard (seção "Indique o ZapScript"). ' +
      'Os 5 áudios são creditados automaticamente após o cadastro do indicado. ' +
      'Não há limite de indicações — cada novo cadastro via link gera o bônus.',
  },
  // ── SUPORTE ──────────────────────────────────────────────────────────────
  {
    titulo: 'Canais de suporte e tempo de resposta',
    categoria: 'outro',
    tags: ['suporte', 'contato', 'atendimento', 'tempo resposta', 'ajuda', 'email', 'whatsapp'],
    conteudo:
      'Canais de atendimento: WhatsApp (número de suporte informado no painel) e e-mail. ' +
      'Tempo de resposta: casos simples respondidos em minutos pelo bot. ' +
      'Casos que requerem análise humana (cobrança, cancelamento, bugs complexos): resposta em até 24h úteis. ' +
      'Horário de atendimento humano: dias úteis, horário comercial (UTC-3). ' +
      'Fora do horário, o bot responde e o humano acompanha na abertura do próximo expediente.',
  },
];

async function main() {
  console.log('🌱 Semeando base de conhecimento do suporte...');
  let criados = 0;
  let pulados = 0;
  for (const t of TOPICOS) {
    const existe = await prisma.knowledgeBase.findFirst({ where: { titulo: t.titulo } });
    if (existe) { console.log(`  • já existe: ${t.titulo}`); pulados++; continue; }
    await prisma.knowledgeBase.create({
      data: { titulo: t.titulo, conteudo: t.conteudo, categoria: t.categoria, tags: t.tags, aprovadoPorAdmin: true },
    });
    criados++;
    console.log(`  ✓ criado: ${t.titulo}`);
  }
  console.log(`\n✅ Concluído. ${criados} tópico(s) novo(s), ${pulados} já existia(m).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
