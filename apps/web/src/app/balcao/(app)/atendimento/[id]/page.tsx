import { redirect } from 'next/navigation';

/** Link direto `/balcao/atendimento/<id>`: abre o console com a conversa selecionada (sem remontar a página a cada troca). */
export default async function AtendimentoDireto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/balcao/atendimento?c=${encodeURIComponent(id)}`);
}
