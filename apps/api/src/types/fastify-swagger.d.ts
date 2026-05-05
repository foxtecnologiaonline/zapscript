declare module '@fastify/swagger' {
  import { FastifyPlugin } from 'fastify';

  interface SwaggerOptions {
    [key: string]: any;
  }

  const plugin: FastifyPlugin<SwaggerOptions>;
  export default plugin;
}

declare module 'nodemailer' {
  export interface TransportOptions {
    [key: string]: any;
  }

  export interface SentMessageInfo {
    messageId?: string;
    response?: string;
    [key: string]: any;
  }

  export interface Transporter {
    sendMail(mailOptions: any): Promise<SentMessageInfo>;
    verify(): Promise<boolean>;
    [key: string]: any;
  }

  export function createTransport(options?: TransportOptions): Transporter;
  export default {
    createTransport,
  };
}
