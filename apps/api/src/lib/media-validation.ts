/**
 * Validação de mídia por magic bytes — nunca confiar só no mimetype/extensão
 * declarados pelo multipart do client. Usado pela boas-vindas automática do
 * Atende (upload de áudio/vídeo, guardados como bytea no Postgres).
 */

export const WELCOME_AUDIO_MAX_BYTES = 2 * 1024 * 1024;  // ~60s de nota de voz
export const WELCOME_VIDEO_MAX_BYTES = 8 * 1024 * 1024;  // ~20s de vídeo curto

function hasFtypBox(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp';
}

function hasEbmlHeader(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

/**
 * MP3 (ID3 ou frame sync), OGG, WAV, MP4/M4A (ftyp) ou WebM (EBML — o
 * MediaRecorder do navegador grava 'audio/webm' por padrão, mesmo container
 * do WebM de vídeo, então o EBML por si só não distingue áudio de vídeo;
 * quem decide isso é o campo do multipart (audio/video), não o magic byte).
 */
export function looksLikeAudio(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.toString('latin1', 0, 3) === 'ID3') return true; // MP3 com tag ID3
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true; // MP3 frame sync
  if (buf.toString('latin1', 0, 4) === 'OggS') return true; // OGG/Opus
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return true; // WAV
  if (hasFtypBox(buf)) return true; // M4A/AAC
  if (hasEbmlHeader(buf)) return true; // WebM (áudio gravado pelo navegador)
  return false;
}

/** MP4 (ftyp) ou WebM/Matroska (cabeçalho EBML). */
export function looksLikeVideo(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (hasFtypBox(buf)) return true; // MP4
  if (hasEbmlHeader(buf)) return true; // WebM/Matroska
  return false;
}
