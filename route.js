import { handleCall, handleRecordingWebhook } from './twilio.js';
import { setupWebSocket } from './websocket.js';

export async function initRoutes(fastify) {
  fastify.post('/call', handleCall);
  fastify.post('/webhook/recording', handleRecordingWebhook);
  fastify.get('/media-stream', { websocket: true }, setupWebSocket);
}
