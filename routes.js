import { handleCall, handleRecordingWebhook, serveTwiML } from './twilio.js';
import { setupWebSocket } from './websocket.js';

export async function initRoutes(fastify) {
  fastify.route({
    method: 'POST',
    url: '/call',
    handler: handleCall,
  });

  fastify.route({
    method: 'POST',
    url: '/webhook/recording',
    handler: handleRecordingWebhook,
  });

  fastify.route({
    method: 'POST', // Twilio envoie un POST pour la TwiML
    url: '/twiml',
    handler: serveTwiML,
  });

  fastify.route({
    method: 'GET',
    url: '/media-stream',
    websocket: true,
    handler: setupWebSocket,
  });
}
