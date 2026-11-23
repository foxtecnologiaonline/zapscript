'use client';
import React from 'react';
import { A11yProvider } from '@/lib/balcao/a11y';
import { BvSessionProvider } from '@/lib/balcao/session';
import { ToastProvider } from './_ui/ui';

export function BvProviders({ children }: { children: React.ReactNode }) {
  return <A11yProvider><ToastProvider><BvSessionProvider>{children}</BvSessionProvider></ToastProvider></A11yProvider>;
}
