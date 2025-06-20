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
  DOMAIN: rawDomain,
  OPENAI_API_KEY,
  API_KEY, // facultatif pour sécuriser n8n
} = process.env;

const DOMAIN = rawDomain.replace(/(^\w+:|^)\/\//, '').replace(/\/+\$/, '');
const VOICE = 'alloy';
const PORT = process.env.PORT || 6060;
const SYSTEM_MESSAGE = `Tu es un assistant vocal professionnel. Tu appelles un professionnel pour lui présenter le label Expert PRO, lancé par Le Guichet Pro : le guichet unique des entreprises, déjà utilisé par plus de 100 000 professionnels en France. Le Guichet Pro aide les entreprises à se développer via la génération de leads, l’accompagnement, et des services comme la conciergerie ou les achats pros. Le label Expert PRO référence uniquement des professionnels, et les met en avant auprès d’autres professionnels de leur secteur. Il permet d’être reconnu comme l’expert référent dans sa zone, d’attirer plus de clients qualifiés et de gagner en crédibilité. L’objectif de ton appel est d’ouvrir la discussion, puis de proposer d’envoyer un lien par WhatsApp ou email pour que le prospect puisse vérifier immédiatement son éligibilité. Sois synthétique, pro et à l’écoute. Tu ne vends rien, tu proposes un premier pas. Emploie un ton naturel, chaleureux et humain. Parle comme un conseiller pro, évite le langage robotique.`;

const outboundTwiML = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Connect>\n    <Stream url="wss://${DOMAIN}/media-stream" />\n  </Connect>\n</Response>`;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

fastify.post('/call', async (req, reply) => {
  const to = req.body?.to;
  const token = req.headers.authorization || req.body.api_key;

  if (!to) return reply.status(400).send({ error: 'Missing "to"' });
  if (API_KEY && token !== `Bearer ${API_KEY}` && token !== API_KEY)
    return reply.status(401).send({ error: 'Unauthorized' });

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

fastify.register(async function (fastify) {
  fastify.get('/media-stream', { websocket: true }, (connection) => {
    console.log('✅ Twilio stream connected');

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

    const sendInitialSessionUpdate = () => {
      openAiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          voice: VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ['audio', 'text'],
        },
      }));

      openAiWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'input_text',
            text: `Bonjour, je suis Emilie de LeguichetPro. Est-ce que vous avez un instant ? Je souhaiterais vous parler du label Expert Pro, qui valorise les professionnels reconnus et vous donne accès à des services dédiés.`,
          }],
        },
      }));


      openAiWs.send(JSON.stringify({ type: 'response.create' }));
    };

    openAiWs.on('open', () => {
      console.log('✅ OpenAI connected');
      setTimeout(sendInitialSessionUpdate, 100);
    });

    openAiWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'response.audio.delta' && msg.delta) {
          connection.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: msg.delta },
          }));
        }
      } catch (err) {
        console.error('Error OpenAI -> Twilio:', err);
      }
    });

    connection.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.event === 'start') {
          streamSid = data.start.streamSid;
        } else if (data.event === 'media' && data.media?.payload) {
          openAiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: data.media.payload,
          }));
        }
      } catch (err) {
        console.error('Error Twilio -> OpenAI:', err);
      }
    });

    connection.on('close', () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log('⛔️ Twilio stream closed');
    });

    openAiWs.on('error', (e) => console.error('OpenAI WebSocket error:', e));
    openAiWs.on('close', () => console.log('🔒 OpenAI WebSocket closed'));
  });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error('❌ Server error:', err);
    process.exit(1);
  }
  console.log(`🚀 Server listening on port ${PORT}`);
});
