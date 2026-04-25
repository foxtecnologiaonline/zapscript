'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function EmailConfirmadoPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    // Supabase redireciona para esta página após confirmar o e-mail
    // Verificamos se há um erro no hash da URL
    const hash = window.location.hash;
    if (hash.includes('error=')) {
      setStatus('error');
    } else {
      setStatus('success');
    }
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#040b09] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#10b981] border-t-transparent rounded-full animate-spin"/>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-[#0d1c19] border border-red-500/20 rounded-2xl p-8">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">❌</span>
            </div>
            <h2 className="text-xl font-bold text-red-400 mb-2">Link inválido ou expirado</h2>
            <p className="text-sm text-[#6ee7b7] mb-6 leading-relaxed">
              O link de confirmação expirou ou já foi usado.<br/>
              Tente criar sua conta novamente para receber um novo link.
            </p>
            <Link href="/cadastro"
              className="block w-full bg-[#10b981] text-[#011a12] font-bold text-sm py-3 rounded-lg hover:bg-[#34d399] transition-colors">
              Criar conta novamente
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="bg-[#0d1c19] border border-[rgba(16,185,129,.15)] rounded-2xl p-8">
          <div className="w-16 h-16 rounded-full bg-[rgba(16,185,129,.12)] flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✅</span>
          </div>
          <h2 className="text-xl font-bold text-[#10b981] mb-2">E-mail confirmado!</h2>
          <p className="text-sm text-[#6ee7b7] mb-6 leading-relaxed">
            Sua identidade foi verificada com sucesso.<br/>
            Agora você pode acessar o ZapScript.
          </p>
          <Link href="/login"
            className="block w-full bg-[#10b981] text-[#011a12] font-bold text-sm py-3 rounded-lg hover:bg-[#34d399] transition-colors">
            Fazer login
          </Link>
        </div>
        <p className="text-xs text-[rgba(16,185,129,.3)] mt-4">
          <Link href="/" className="hover:text-[#10b981] transition-colors">zapscript.me</Link>
        </p>
      </div>
    </div>
  );
}
