import DeletionStatusClient from './DeletionStatusClient';

/**
 * No Next 15 `params` é Promise até em client component, e desempacotar lá
 * exigiria React.use() — que só existe no React 19. Como o resto do app segue
 * no React 18 de propósito (o Next 15 aceita ^18.2.0 como peer), a rota passou
 * a ser um server component fino que resolve o params e entrega `code` como
 * prop comum. A tela em si não mudou, só saiu para DeletionStatusClient.tsx.
 */
export default async function DeletionStatusPage(
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  return <DeletionStatusClient code={code} />;
}
