const isProd = process.env.NODE_ENV === 'production';

function write(level: string, msg: string, meta?: object) {
  const entry = { level, time: new Date().toISOString(), msg, ...meta };
  if (isProd) {
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️ ' : '🔍';
    const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
    process.stdout.write(`${prefix} [${entry.time}] ${msg}${metaStr}\n`);
  }
}

export const logger = {
  info:  (msg: string, meta?: object) => write('info',  msg, meta),
  warn:  (msg: string, meta?: object) => write('warn',  msg, meta),
  error: (msg: string, meta?: object) => write('error', msg, meta),
};
