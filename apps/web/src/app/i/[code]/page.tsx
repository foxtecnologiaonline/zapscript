'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { storeAffiliateCode } from '@/lib/affiliate';

/* ─────────────────────────────────────────────────────────
   Link curto de afiliado — zapscript.me/i/CODE
   Guarda a atribuição e redireciona pra home já limpa, sem
   expor o código pro indicado.
   ───────────────────────────────────────────────────────── */
export default function AffiliateShortLink() {
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    const code = (params?.code as string) || '';
    if (code) storeAffiliateCode(code);
    router.replace('/');
  }, [params, router]);

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
      <div className="text-brand-primary text-sm animate-pulse">Carregando…</div>
    </div>
  );
}
