import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

ffmpeg.setFfmpegPath(ffmpegPath.path);

const FFMPEG_TIMEOUT_MS = parseInt(process.env.FFMPEG_TIMEOUT_MS || '120000', 10);

/**
 * Converte buffer de áudio para MP3 64kbps (aceito pela API Whisper da OpenAI/Groq).
 *
 * Usa arquivos temporários em disco em vez de pipe stdin/stdout.
 * Motivo: FFmpeg via pipe não consegue fazer seek no input, o que impede a
 * detecção correta do formato em containers como MP4, M4A, WebM, MOV etc.
 * Com arquivo em disco, o FFmpeg faz seek normalmente e detecta qualquer formato.
 *
 * Formatos suportados: OGG, OPUS, MP3, M4A, MP4, WAV, WebM, MPEG, AAC,
 * FLAC, WMA, AMR, 3GP, AIFF, MOV e qualquer codec que o ffmpeg suporte.
 */
export function convertToMp3(inputBuffer: Buffer, inputFormat?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Criar diretório temporário isolado
    let tempDir: string;
    try {
      tempDir = mkdtempSync(join(tmpdir(), 'zs-audio-'));
    } catch (err) {
      return reject(new Error(`Falha ao criar diretório temporário: ${(err as Error).message}`));
    }

    const ext     = inputFormat ? `.${inputFormat}` : '.bin';
    const tempIn  = join(tempDir, `input${ext}`);
    const tempOut = join(tempDir, 'output.mp3');

    const cleanup = () => {
      try { unlinkSync(tempIn);  } catch { /* ignorar */ }
      try { unlinkSync(tempOut); } catch { /* ignorar */ }
      try { rmdirSync(tempDir);  } catch { /* ignorar */ }
    };

    // Gravar input em disco para que FFmpeg possa fazer seek
    try {
      writeFileSync(tempIn, inputBuffer);
    } catch (err) {
      cleanup();
      return reject(new Error(`Falha ao gravar arquivo temporário: ${(err as Error).message}`));
    }

    let settled = false;
    const done = (err: Error | null, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (err) reject(err);
      else     resolve(result!);
    };

    const timer = setTimeout(() => {
      try { command.kill('SIGKILL'); } catch { /* ignorar */ }
      done(new Error(`FFmpeg timeout após ${FFMPEG_TIMEOUT_MS / 1000}s`));
    }, FFMPEG_TIMEOUT_MS);

    // FFmpeg lê do disco (com seek) → grava MP3 no disco
    const command = ffmpeg(tempIn)
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .audioChannels(1)   // mono — reduz tamanho sem perda de inteligibilidade
      .format('mp3')
      .save(tempOut)
      .on('end', () => {
        try {
          const output = readFileSync(tempOut);
          if (output.length === 0) {
            done(new Error('FFmpeg produziu output vazio — formato de entrada não suportado'));
          } else {
            done(null, output);
          }
        } catch (err) {
          done(new Error(`Falha ao ler MP3 convertido: ${(err as Error).message}`));
        }
      })
      .on('error', (err: Error) => done(new Error(`FFmpeg: ${err.message}`)));
  });
}
