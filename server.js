import Fastify from 'fastify';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { initRoutes } from './routes.js';

dotenv.config();

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

await initRoutes(fastify);

const PORT = process.env.PORT || 6060;
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error('❌ Server error:', err);
    process.exit(1);
  }
  console.log(`🚀 Server listening on port ${PORT}`);
});
