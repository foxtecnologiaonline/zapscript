'use client';
import { useEffect } from 'react';
import { captureUtmFromUrl } from '@/lib/utm';

/** Captura ?utm_source/utm_campaign/utm_medium em qualquer página de entrada. */
export default function UtmCapture() {
  useEffect(() => { captureUtmFromUrl(); }, []);
  return null;
}
