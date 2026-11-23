'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBvSession } from '@/lib/balcao/session';
import { HOME_BY_ROLE } from '@/lib/balcao/nav';
import { Spinner } from '../_ui/ui';

export default function BalcaoHome() {
  const { me } = useBvSession();
  const router = useRouter();
  useEffect(() => { if (me) router.replace(HOME_BY_ROLE[me.user.role] ?? '/balcao/conta'); }, [me, router]);
  return <div className="flex justify-center p-10"><Spinner size={28} /></div>;
}
