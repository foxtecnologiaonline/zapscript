import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { Readable, PassThrough } from 'stream';

ffmpeg.setFfmpegPath(ffmpegPath.path);

const FFMPEG_TIMEOUT_MS = 120_000;

/**
 * Converte buffer de áudio para MP3 (aceito pela API Whisper da OpenAI/Groq).
 * Formatos suportados via ffmpeg: OGG, OPUS, MP3, M4A, MP4, WAV, WebM, MPEG,
 * AAC, FLAC, WMA, AMR, 3GP, AIFF — inferido automaticamente pelo ffmpeg.
 */
export function convertToMp3(inputBuffer: Buffer, inputFormat?: string): Promise<Buffer> {
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

    let cmd = ffmpeg(inputStream);
    if (inputFormat) cmd = cmd.inputFormat(inputFormat);
    const command = cmd
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .format('mp3')
      .on('error', (err) => done(err));

    command.pipe(outputStream, { end: true });
  });
}
