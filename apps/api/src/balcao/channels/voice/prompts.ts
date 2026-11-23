import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../../../lib/logger';
import { getObjectBuffer } from '../../core/storage';
import type { ResolvedIvrPrompt } from './ivr';

/**
 * Prompts da URA: áudio enviado (storage → cópia para o volume de sons do Asterisk) OU texto → TTS (cache por hash).
 * O provedor é injetável (`PromptProvider`) e mockado nos testes. Sem TTS configurado devolve silêncio + aviso.
 */
export interface ResolvedMedia { media: string[]; source: 'audio' | 'tts' | 'cache' | 'silence'; warning?: string }

export interface PromptProvider {
  /** Converte um prompt em URIs de mídia do Asterisk (`sound:…`). Nunca lança. */
  resolve(orgId: string, p: ResolvedIvrPrompt): Promise<ResolvedMedia>;
}

export interface TtsClient {
  /** Devolve áudio no formato que o Asterisk lê direto (`ext`: sln24 = PCM 16-bit 24 kHz bruto). */
  synthesize(text: string, o: { lang: string; voice: string; model: string }): Promise<{ data: Buffer; ext: string }>;
}

/** TTS OpenAI (response_format=pcm → PCM 16-bit mono 24 kHz, gravado como .sln24 — sem conversão externa). */
export class OpenAiTtsClient implements TtsClient {
  constructor(private apiKey: string) {}
  async synthesize(text: string, o: { lang: string; voice: string; model: string }) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey, timeout: 20_000 });
    const res = await client.audio.speech.create({ model: o.model, voice: o.voice as any, input: text, response_format: 'pcm' });
    return { data: Buffer.from(await res.arrayBuffer()), ext: 'sln24' };
  }
}

export const SOUNDS_PREFIX = 'balcao';
const SILENCE = 'sound:silence/1';
export const ALLOWED_AUDIO_EXT = ['wav', 'sln', 'sln16', 'sln24', 'ulaw', 'alaw', 'gsm'];

export interface PromptProviderOptions { soundsDir?: string; tts?: TtsClient | null; voice?: string; model?: string }

export class DefaultPromptProvider implements PromptProvider {
  private inflight = new Map<string, Promise<ResolvedMedia>>();
  private warned = new Set<string>();
  constructor(private o: PromptProviderOptions = {}) {}

  private get dir() { return this.o.soundsDir ?? process.env.BV_ASTERISK_SOUNDS_DIR ?? '/var/lib/asterisk/sounds/balcao'; }
  private get tts(): TtsClient | null {
    if (this.o.tts !== undefined) return this.o.tts;
    const key = process.env.BV_TTS_API_KEY || process.env.OPENAI_API_KEY;
    return process.env.BV_TTS_ENABLED === '1' && key ? new OpenAiTtsClient(key) : null;
  }

  async resolve(orgId: string, p: ResolvedIvrPrompt): Promise<ResolvedMedia> {
    try {
      if (p.audioKey) return await this.fromAudio(orgId, p.audioKey);
      if (!p.text?.trim()) return { media: [], source: 'silence' };
      return await this.fromText(orgId, p.text.trim(), p.lang);
    } catch (err: any) {
      logger.warn({ err: err?.message, orgId }, '[balcao/voice] falha ao resolver prompt; usando silêncio');
      return { media: [SILENCE], source: 'silence', warning: err?.message };
    }
  }

  private async fromAudio(orgId: string, key: string): Promise<ResolvedMedia> {
    if (!key.startsWith(`${orgId}/`)) throw new Error('audioKey de outro órgão');
    const ext = (path.extname(key).slice(1) || 'wav').toLowerCase();
    if (!ALLOWED_AUDIO_EXT.includes(ext)) throw new Error('formato de áudio não suportado');
    const base = `audio-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 20)}`;
    const file = path.join(this.dir, orgId, `${base}.${ext}`);
    if (!fs.existsSync(file)) {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, await getObjectBuffer(key));
      await fs.promises.rename(tmp, file);
    }
    return { media: [`sound:${SOUNDS_PREFIX}/${orgId}/${base}`], source: 'audio' };
  }

  private async fromText(orgId: string, text: string, lang: string): Promise<ResolvedMedia> {
    const voice = this.o.voice ?? process.env.BV_TTS_VOICE ?? 'alloy';
    const model = this.o.model ?? process.env.BV_TTS_MODEL ?? 'tts-1';
    const hash = crypto.createHash('sha1').update(`${model}|${voice}|${lang}|${text}`).digest('hex').slice(0, 24);
    const base = `tts-${hash}`;
    const media = [`sound:${SOUNDS_PREFIX}/${orgId}/${base}`];
    const existing = ALLOWED_AUDIO_EXT.map((e) => path.join(this.dir, orgId, `${base}.${e}`)).find((f) => fs.existsSync(f));
    if (existing) return { media, source: 'cache' };
    const tts = this.tts;
    if (!tts) {
      const w = 'TTS não configurado (BV_TTS_ENABLED=1 + chave): prompt de texto será silêncio';
      if (!this.warned.has(w)) { this.warned.add(w); logger.warn(w); }
      return { media: [SILENCE], source: 'silence', warning: w };
    }
    const k = `${orgId}:${base}`;
    let job = this.inflight.get(k);
    if (!job) {
      job = (async () => {
        const out = await tts.synthesize(text, { lang, voice, model });
        const file = path.join(this.dir, orgId, `${base}.${out.ext}`);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, out.data);
        await fs.promises.rename(tmp, file);
        return { media, source: 'tts' as const };
      })().finally(() => this.inflight.delete(k));
      this.inflight.set(k, job);
    }
    return job;
  }
}

let provider: PromptProvider = new DefaultPromptProvider();
export const getPromptProvider = () => provider;
export function setPromptProvider(p: PromptProvider) { provider = p; }

/** Lista todos os prompts (por idioma) de uma definição — para pré-aquecer TTS ao publicar. */
export function collectPrompts(def: { nodes: Record<string, any> }): ResolvedIvrPrompt[] {
  const out: ResolvedIvrPrompt[] = [];
  const add = (p: any, lang: string) => { if (p && (p.text || p.audioKey)) out.push({ text: p.text ?? '', audioKey: p.audioKey, lang }); };
  for (const n of Object.values(def.nodes)) {
    for (const key of ['prompt', 'timeoutPrompt', 'invalidPrompt']) {
      const p = (n as any)[key];
      if (!p) continue;
      add(p, p.lang ?? 'pt-BR');
      for (const [l, v] of Object.entries(p.i18n ?? {})) add(v, l);
    }
  }
  return out;
}

export async function prewarmPrompts(orgId: string, def: { nodes: Record<string, any> }, prov: PromptProvider = provider): Promise<number> {
  const list = collectPrompts(def);
  await Promise.all(list.map((p) => prov.resolve(orgId, p)));
  return list.length;
}
