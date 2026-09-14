import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-bold">ZapBox</h1>
      <p className="max-w-md text-gray-600">
        Widget de chat via WhatsApp, plug-and-play, para embutir no site de qualquer cliente.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium">
          Entrar
        </Link>
        <Link href="/register" className="px-4 py-2 rounded-lg border border-green-600 text-green-700 font-medium">
          Criar conta
        </Link>
      </div>
    </main>
  );
}
