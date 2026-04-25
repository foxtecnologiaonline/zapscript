import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#040b09] flex items-center justify-center px-6">
      <div className="text-center">
        <div className="text-8xl font-black text-[#10b981] opacity-20 leading-none mb-4">404</div>
        <h1 className="text-2xl font-bold mb-2">Página não encontrada</h1>
        <p className="text-[#6ee7b7] text-sm font-light mb-8">A página que você está procurando não existe ou foi movida.</p>
        <Link href="/" className="inline-flex items-center gap-2 bg-[#10b981] text-[#011a12] font-bold px-6 py-3 rounded-xl text-sm hover:bg-[#34d399] transition-colors">
          ← Voltar ao início
        </Link>
      </div>
    </div>
  );
}
