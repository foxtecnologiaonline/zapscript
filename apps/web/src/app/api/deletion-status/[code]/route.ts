import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const { code } = params;

    if (!code || code.length < 10) {
      return NextResponse.json(
        { error: 'Código de confirmação inválido' },
        { status: 400 }
      );
    }

    // TODO: Buscar status real do banco de dados
    // const status = await prisma.deletionRequest.findUnique({
    //   where: { confirmationCode: code },
    // });

    // Por enquanto, retornar mock com base no timestamp no código
    const requestedDate = new Date();
    const expectedCompletionDate = new Date(requestedDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Simular diferentes status baseado no código
    const statusMap: Record<string, 'pending' | 'processing' | 'completed' | 'failed'> = {
      pending: 'pending',
      processing: 'processing',
      completed: 'completed',
      error: 'failed',
    };

    // Determinar status aleatório para demo (remover em produção)
    const statusList: Array<'pending' | 'processing' | 'completed'> = ['pending', 'processing', 'completed'];
    const currentStatus = statusList[Math.floor(Math.random() * statusList.length)];

    const statusMessages: Record<string, string> = {
      pending: 'Sua solicitação foi recebida e está na fila de processamento. Você será notificado por e-mail quando o processamento começar.',
      processing: 'Seus dados estão sendo deletados. Este processo pode levar até 30 dias conforme exigido pela LGPD.',
      completed: 'Todos os seus dados foram deletados com sucesso. Você pode fechar esta página.',
      failed: 'Houve um erro ao processar sua solicitação. Por favor, contate o suporte.',
    };

    return NextResponse.json(
      {
        status: currentStatus,
        confirmationCode: code,
        requestedAt: requestedDate.toISOString(),
        expectedCompletionDate: expectedCompletionDate.toISOString(),
        message: statusMessages[currentStatus] || statusMessages.pending,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Deletion Status] Erro ao buscar status:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar status de exclusão' },
      { status: 500 }
    );
  }
}
