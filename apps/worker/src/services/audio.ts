import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { Readable, PassThrough } from 'stream';

ffmpeg.setFfmpegPath(ffmpegPath.path);

const FFMPEG_TIMEOUT_MS = 120_000;

/**
 * Converte buffer de áudio OGG/OPUS (formato WhatsApp)
 * para MP3 (aceito pela API Whisper da OpenAI).
 */
export function convertToMp3(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const inputStream  = Readable.from(inputBuffer);
    const outputStream = new PassThrough();

    let settled = false;
    const done = (err: Error | null, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(result!);
    };

    const timer = setTimeout(() => {
      command.kill('SIGKILL');
      done(new Error(`FFmpeg timeout após ${FFMPEG_TIMEOUT_MS / 1000}s`));
    }, FFMPEG_TIMEOUT_MS);

    outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    outputStream.on('end', () => done(null, Buffer.concat(chunks)));
    outputStream.on('error', (err) => done(err));

    const command = ffmpeg(inputStream)
      .inputFormat('ogg')
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .format('mp3')
      .on('error', (err) => done(err));

    command.pipe(outputStream, { end: true });
  });
}
