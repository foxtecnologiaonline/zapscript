import React from 'react';
import { CHANNEL_LABEL } from '@/lib/balcao/format';
import type { Channel } from './types';

const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

const PATHS: Record<Channel, React.ReactNode> = {
  WHATSAPP: <><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-5.2A8.5 8.5 0 1 1 21 11.5z" /><path d="M9 9.5c.5 2 2.5 4 5 5l1.2-1.2-2-1-.8.8c-.8-.4-1.600-1.200-2-2l.8-.8-1-2z" /></>,
  WEBCHAT: <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 8h18M8 22l3-4" /></>,
  EMAIL: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  VOICE: <path d="M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
};

/** Ícone + texto do canal (o texto nunca é omitido: a informação não depende só do desenho). */
export function ChannelTag({ channel, className = '' }: { channel: Channel; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <svg {...base}>{PATHS[channel]}</svg>
      <span>{CHANNEL_LABEL[channel] ?? channel}</span>
    </span>
  );
}

export const LockIcon = () => <svg {...base}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const ClipIcon = () => <svg {...base}><path d="m21 11-8.500 8.500a5 5 0 0 1-7-7L14 4a3.500 3.500 0 0 1 5 5l-8.500 8.500a2 2 0 0 1-3-3L15 7" /></svg>;
export const SparkIcon = () => <svg {...base}><path d="M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800L12 3zM19 16l.8 2.200L22 19l-2.200.8L19 22l-.8-2.200L16 19l2.200-.8L19 16z" /></svg>;
export const DownIcon = () => <svg {...base}><path d="M12 5v14M6 13l6 6 6-6" /></svg>;
export const BackIcon = () => <svg {...base}><path d="M15 6l-6 6 6 6" /></svg>;
export const RobotIcon = () => <svg {...base}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></svg>;
