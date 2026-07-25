import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'https://api.zapscript.me';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code || code.length < 10) {
      return NextResponse.json({ error: 'Código de confirmação inválido' }, { status: 400 });
    }

    // Buscar status real no banco via API interna
    try {
      const res = await fetch(`${API_URL}/privacy/meta-deletion-status/${encodeURIComponent(code)}`, {
        signal: AbortSignal.timeout(8_000),
      });

      if (res.ok) {
        const data = await res.json();

        const statusMessages: Record<string, string> = {
          pending:    'Sua solicitação foi recebida e está na fila de processamento.',
          processing: 'Seus dados estão sendo deletados. Este processo pode levar até 30 dias conforme exigido pela LGPD.',
          completed:  'Todos os seus dados foram deletados com sucesso.',
          failed:     'Houve um erro ao processar sua solicitação. Por favor, contate o suporte.',
        };

        return NextResponse.json(
          {
            status:                 data.status || 'pending',
            confirmationCode:       code,
            requestedAt:            data.requestedAt,
            expectedCompletionDate: data.expectedCompletionDate,
            message:                statusMessages[data.status] || statusMessages.pending,
          },
          { status: 200 }
        );
      }

      if (res.status === 404) {
        return NextResponse.json({ error: 'Código de confirmação não encontrado.' }, { status: 404 });
      }
    } catch (err) {
      console.error('[Deletion Status] Falha ao consultar API:', err);
    }

    // Fallback: código válido mas DB inacessível
    return NextResponse.json(
      {
        status:           'pending',
        confirmationCode: code,
        requestedAt:      new Date().toISOString(),
        message:          'Sua solicitação foi recebida e está sendo processada.',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[Deletion Status] Erro:', error);
    return NextResponse.json({ error: 'Erro ao buscar status de exclusão' }, { status: 500 });
  }
}
