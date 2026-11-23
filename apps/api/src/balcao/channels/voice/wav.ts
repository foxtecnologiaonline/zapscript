/** WAV PCM 16-bit mono mínimo (8 kHz por padrão) — gravações fictícias do simulador e testes. */
export function makeToneWav(seconds = 1, sampleRate = 8000, freq = 440): Buffer {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 6000), i * 2);
  return wrapPcmAsWav(data, sampleRate);
}

export function wrapPcmAsWav(pcm: Buffer, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Lê cabeçalho WAV simples; null se não for RIFF/WAVE PCM. */
export function inspectWav(buf: Buffer): { channels: number; sampleRate: number; bits: number; format: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  return { format: buf.readUInt16LE(20), channels: buf.readUInt16LE(22), sampleRate: buf.readUInt32LE(24), bits: buf.readUInt16LE(34) };
}
