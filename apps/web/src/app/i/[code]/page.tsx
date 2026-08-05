'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { storeAffiliateCode } from '@/lib/affiliate';

/* ─────────────────────────────────────────────────────────
   Link curto de indicação — zapscript.me/i/CODE

   Dois formatos coexistem aqui:
   - Código antigo do programa de Afiliados (8 letras/números maiúsculos,
     ex.: "K3F9X2QA", gerado por genAffiliateCode()): comportamento antigo —
     guarda a atribuição em localStorage e volta pra home limpa.
   - Slug novo da Carteira de Crédito (minúsculo, ex.: "joaops", 1º nome +
     iniciais — ver lib/referralSlug.ts no backend): redireciona direto pro
     cadastro com ?ref=<slug>, que já resolve tanto slug quanto refCode.
   ───────────────────────────────────────────────────────── */
const OLD_AFFILIATE_CODE = /^[A-Z0-9]{8}$/;

export default function ReferralShortLink() {
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    const code = (params?.code as string) || '';
    if (!code) { router.replace('/'); return; }

    if (OLD_AFFILIATE_CODE.test(code)) {
      storeAffiliateCode(code);
      router.replace('/');
    } else {
      router.replace(`/cadastro?ref=${encodeURIComponent(code)}`);
    }
  }, [params, router]);

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
      <div className="text-brand-primary text-sm animate-pulse">Carregando…</div>
    </div>
  );
}
