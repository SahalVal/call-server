import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

dotenv.config();

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) {
  console.error('⚠️ OPENAI_API_KEY missing in .env');
  process.exit(1);
}

const SYSTEM_MESSAGE = 'You are a helpful AI voice assistant. Answer politely and clearly.';
const VOICE = 'alloy';
const PORT = process.env.PORT || 5050;

const LOG_EVENT_TYPES = [
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
];

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Health check
fastify.get('/', async (req, reply) => {
  return { message: 'AI Voice Assistant Server running' };
});

// WebSocket Media Stream endpoint
fastify.get('/media-stream', { websocket: true }, (connection, req) => {
  console.log('Client connected to /media-stream');

  const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  let streamSid = null;

  const sendSessionUpdate = () => {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: VOICE,
        instructions: SYSTEM_MESSAGE,
        modalities: ["text", "audio"],
        temperature: 0.7,
      }
    };
    openAiWs.send(JSON.stringify(sessionUpdate));
  };

  openAiWs.on('open', () => {
    console.log('Connected to OpenAI Realtime API');
    setTimeout(sendSessionUpdate, 250);
  });

  openAiWs.on('message', (data) => {
    try {
      const response = JSON.parse(data);
      if (LOG_EVENT_TYPES.includes(response.type)) {
        console.log('OpenAI event:', response.type);
      }
      if (response.type === 'session.updated') {
        console.log('Session updated');
      }
      if (response.type === 'response.audio.delta' && response.delta) {
        // Send audio delta back to Twilio client
        const audioDelta = {
          event: 'media',
          streamSid,
          media: { payload: response.delta }
        };
        connection.send(JSON.stringify(audioDelta));
      }
    } catch (err) {
      console.error('Error parsing OpenAI message:', err);
    }
  });

  connection.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      switch (data.event) {
        case 'media':
          if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: data.media.payload
            }));
          }
          break;
        case 'start':
          streamSid = data.start.streamSid;
          console.log('Stream started with SID:', streamSid);
          break;
        default:
          console.log('Unhandled Twilio event:', data.event);
      }
    } catch (err) {
      console.error('Error parsing Twilio message:', err);
    }
  });

  connection.on('close', () => {
    console.log('Client disconnected from media-stream');
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });

  openAiWs.on('close', () => {
    console.log('OpenAI WebSocket closed');
  });

  openAiWs.on('error', (err) => {
    console.error('OpenAI WebSocket error:', err);
  });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on port ${PORT}`);
});
