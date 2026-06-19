'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Quem chega em /indique?ref=CODE (link compartilhado) vai direto pro cadastro com o código preservado. */
export default function IndiqueClient() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) router.replace(`/cadastro?ref=${encodeURIComponent(ref)}`);
  }, [searchParams, router]);

  return null;
}
