import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import twilio from 'twilio';

dotenv.config();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PHONE_NUMBER_FROM,
  DOMAIN,
  OPENAI_API_KEY,
} = process.env;

const SYSTEM_MESSAGE = 'You are a helpful and friendly AI assistant. Greet politely and guide the user.';
const VOICE = 'alloy';
const PORT = process.env.PORT || 6060;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !PHONE_NUMBER_FROM || !DOMAIN || !OPENAI_API_KEY) {
  console.error('Missing .env values. Please fill them in.');
  process.exit(1);
}

const outboundTwiML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${DOMAIN}/media-stream" />
  </Connect>
</Response>`;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Healthcheck
fastify.get('/', async () => ({ status: 'ok' }));

// Webhook to trigger call from n8n
fastify.post('/call', async (req, reply) => {
  const to = req.body?.to;
  if (!to) return reply.status(400).send({ error: 'Missing "to" parameter.' });

  try {
    const call = await client.calls.create({
      from: PHONE_NUMBER_FROM,
      to,
      twiml: outboundTwiML,
    });
    return { message: 'Call initiated', sid: call.sid };
  } catch (err) {
    console.error('Call error:', err);
    return reply.status(500).send({ error: 'Call failed', details: err.message });
  }
});

// Media stream WebSocket (Twilio <-> OpenAI)
fastify.register(async function (fastify) {
  fastify.get('/media-stream', { websocket: true }, (connection) => {
    console.log('Twilio stream connected');

    const openAiWs = new WebSocket(
      'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      }
    );

    let streamSid = null;
    let isOpenAiReady = false;

    const sendInitialSessionUpdate = () => {
      if (openAiWs.readyState !== WebSocket.OPEN) return;

      openAiWs.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            turn_detection: { type: 'server_vad' },
            input_audio_format: 'g711_ulaw',
            output_audio_format: 'g711_ulaw',
            voice: VOICE,
            instructions: SYSTEM_MESSAGE,
            modalities: ['text', 'audio'],
          },
        })
      );

      openAiWs.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: "Hello there! I'm your AI assistant from Twilio & OpenAI. How can I help?",
              },
            ],
          },
        })
      );

      openAiWs.send(JSON.stringify({ type: 'response.create' }));
    };

    openAiWs.on('open', () => {
      console.log('Connected to OpenAI realtime API');
      isOpenAiReady = true;
      sendInitialSessionUpdate();
    });

    openAiWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (
          msg.type === 'response.audio.delta' &&
          msg.delta &&
          connection?.socket?.readyState === WebSocket.OPEN
        ) {
          connection.socket.send(
            JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: Buffer.from(msg.delta, 'base64').toString('base64') },
            })
          );
        }
      } catch (e) {
        console.error('Error handling OpenAI msg:', e);
      }
    });

    connection.socket.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.event === 'start') {
          streamSid = data.start.streamSid;
        } else if (
          data.event === 'media' &&
          isOpenAiReady &&
          openAiWs.readyState === WebSocket.OPEN
        ) {
          openAiWs.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: data.media.payload,
            })
          );
        }
      } catch (err) {
        console.error('Failed to parse or handle message from Twilio:', err);
      }
    });

    connection.socket.on('close', () => {
      console.log('Twilio stream closed');
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
    });
  });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
  console.log(`Server running on port ${PORT}`);
});
