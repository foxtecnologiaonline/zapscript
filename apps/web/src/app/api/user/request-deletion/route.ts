import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { email, motivo } = await req.json();

    // Validação básica
    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { message: 'E-mail inválido' },
        { status: 400 }
      );
    }

    // Enviar solicitação para o backend (API)
    // Assumindo que a API está em NEXT_PUBLIC_API_URL ou variável de ambiente
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    const response = await fetch(`${apiUrl}/user/request-deletion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        motivo: motivo || '',
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { message: errorData.message || 'Erro ao processar solicitação' },
        { status: response.status }
      );
    }

    return NextResponse.json(
      { message: 'Solicitação de exclusão recebida com sucesso' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Erro ao processar exclusão:', error);
    return NextResponse.json(
      { message: 'Erro ao processar solicitação' },
      { status: 500 }
    );
  }
}
