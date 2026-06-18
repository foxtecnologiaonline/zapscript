'use client';
import { useEffect } from 'react';
import { captureAffiliateFromUrl } from '@/lib/affiliate';

export function AffiliateCapture() {
  useEffect(() => { captureAffiliateFromUrl(); }, []);
  return null;
}
