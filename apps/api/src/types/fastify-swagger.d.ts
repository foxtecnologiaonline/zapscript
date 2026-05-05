declare module '@fastify/swagger' {
  import { FastifyPlugin } from 'fastify';

  interface SwaggerOptions {
    [key: string]: any;
  }

  const plugin: FastifyPlugin<SwaggerOptions>;
  export default plugin;
}
