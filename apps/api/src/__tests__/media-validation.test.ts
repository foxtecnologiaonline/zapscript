import { looksLikeAudio, looksLikeVideo } from '../lib/media-validation';

describe('media-validation', () => {
  describe('looksLikeAudio', () => {
    it('aceita MP3 com tag ID3', () => {
      expect(looksLikeAudio(Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00\x00\x00', 'binary'))).toBe(true);
    });

    it('aceita MP3 sem tag (frame sync 0xFF 0xFB)', () => {
      expect(looksLikeAudio(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    });

    it('aceita OGG/Opus', () => {
      expect(looksLikeAudio(Buffer.from('OggS' + '\x00'.repeat(10), 'binary'))).toBe(true);
    });

    it('aceita WAV (RIFF/WAVE)', () => {
      const buf = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE')]);
      expect(looksLikeAudio(buf)).toBe(true);
    });

    it('aceita M4A/MP4 (ftyp box)', () => {
      const buf = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A '), Buffer.from([0, 0, 0, 0])]);
      expect(looksLikeAudio(buf)).toBe(true);
    });

    it('aceita WebM (EBML) — VoiceRecorder.tsx grava audio/webm por padrão', () => {
      const buf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(looksLikeAudio(buf)).toBe(true);
    });

    it('rejeita um arquivo qualquer disfarçado de áudio', () => {
      expect(looksLikeAudio(Buffer.from('<?php system($_GET[0]); ?>'))).toBe(false);
    });

    it('rejeita buffer curto demais', () => {
      expect(looksLikeAudio(Buffer.from([0xff, 0xfb]))).toBe(false);
    });
  });

  describe('looksLikeVideo', () => {
    it('aceita MP4 (ftyp box)', () => {
      const buf = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from([0, 0, 0, 0])]);
      expect(looksLikeVideo(buf)).toBe(true);
    });

    it('aceita WebM (EBML)', () => {
      const buf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(looksLikeVideo(buf)).toBe(true);
    });

    it('rejeita um executável disfarçado de vídeo', () => {
      expect(looksLikeVideo(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00', 'binary'))).toBe(false);
    });
  });
});
