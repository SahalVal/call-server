import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import twilio from 'twilio';
import fetch from 'node-fetch';

dotenv.config();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PHONE_NUMBER_FROM,
  DOMAIN: rawDomain,
  OPENAI_API_KEY,
  API_KEY,
} = process.env;

const INTRO_TEXT = `Bonjour, je suis Emilie de LeguichetPro. Est-ce que vous avez un instant ? Je souhaiterais vous parler du label Expert Pro, qui valorise les professionnels reconnus et vous donne accès à des services dédiés.`;

const DOMAIN = rawDomain.replace(/(^\w+:|^)\/\//, '').replace(/\/+\$/, '');
const VOICE = 'alloy';
const PORT = process.env.PORT || 6060;
const SYSTEM_MESSAGE = `Tu es un assistant vocal professionnel, féminin, prénommée Emilie. Tu appelles un professionnel pour lui présenter le label Expert PRO, lancé par Le Guichet Pro : le guichet unique des entreprises, déjà utilisé par plus de 100 000 professionnels en France.

Le Guichet Pro aide les entreprises à se développer via la génération de leads, l’accompagnement, et des services comme la conciergerie ou les achats pros. Le label Expert PRO référence uniquement des professionnels, et les met en avant auprès d’autres professionnels de leur secteur. Il permet d’être reconnu comme l’expert référent dans sa zone, d’attirer plus de clients professionnels qualifiés et de gagner en crédibilité.

L’objectif de ton appel est d’ouvrir la discussion, puis de proposer d’envoyer un lien par WhatsApp ou email pour que le prospect puisse vérifier en quelques secondes s'il reste des places pour rejoindre le label. Tu ne vends rien, tu proposes un premier pas.

Important : Commence toujours chaque appel par la phrase suivante, mot pour mot, sans jamais rien ajouter, ni changer, ni omettre. Attends d’avoir fini la phrase avant d’écouter l’autre personne.
Lis exactement : "${INTRO_TEXT}"

Adopte un ton naturel, chaleureux, enthousiaste, positif et professionnel. Parle rapidement mais articule, marque des pauses naturelles, ta voix doit être fluide et naturelle pas robotique du tout. Après la phrase d’intro, attends la réponse de ton interlocuteur avant de poursuivre.`;

const outboundTwiML = (recordingCallbackUrl) => `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start><Record recordingStatusCallback="${recordingCallbackUrl}" /></Start>
  <Connect>
    <Stream url="wss://${DOMAIN}/media-stream" />
  </Connect>
</Response>`;

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
      twiml: outboundTwiML(`https://bridge.youzend.com/webhook/recording`),
    });
    return { message: 'Call initiated', sid: call.sid };
  } catch (err) {
    console.error('Call error:', err);
    return reply.status(500).send({ error: 'Call failed', details: err.message });
  }
});

fastify.post('/webhook/recording', async (req, reply) => {
  const recordingUrl = req.body?.RecordingUrl;
  const callSid = req.body?.CallSid;

  try {
    await fetch('https://bridge.youzend.com/webhook/recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, recordingUrl }),
    });
    reply.send({ status: 'Recording forwarded' });
  } catch (error) {
    console.error('Error forwarding recording:', error);
    reply.status(500).send({ error: 'Failed to forward recording' });
  }
});

fastify.get('/media-stream', { websocket: true }, (connection) => {
  console.log('✅ Twilio stream connected');
  const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  let streamSid = null;
  let latestMediaTimestamp = 0;
  let lastAssistantItem = null;
  let markQueue = [];
  let responseStartTimestampTwilio = null;
  const audioQueue = [];

  const flushAudioQueue = () => {
    while (audioQueue.length > 0 && openAiWs.readyState === WebSocket.OPEN) {
      openAiWs.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: audioQueue.shift(),
      }));
    }
  };

  const handleSpeechStartedEvent = () => {
    if (markQueue.length > 0 && responseStartTimestampTwilio != null && lastAssistantItem) {
      const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
      openAiWs.send(JSON.stringify({
        type: 'conversation.item.truncate',
        item_id: lastAssistantItem,
        content_index: 0,
        audio_end_ms: elapsedTime,
      }));
      connection.send(JSON.stringify({ event: 'clear', streamSid }));
      markQueue = [];
      lastAssistantItem = null;
      responseStartTimestampTwilio = null;
    }
  };

  openAiWs.on('open', () => {
    console.log('✅ OpenAI connected');
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
    openAiWs.send(JSON.stringify({ type: 'response.create' }));
    flushAudioQueue();
  });

  openAiWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'response.audio.delta' && msg.delta) {
        connection.send(JSON.stringify({ event: 'media', streamSid, media: { payload: msg.delta } }));
        if (!responseStartTimestampTwilio) responseStartTimestampTwilio = latestMediaTimestamp;
        if (msg.item_id) lastAssistantItem = msg.item_id;
        markQueue.push('responsePart');
      } else if (msg.type === 'input_audio_buffer.speech_started') {
        handleSpeechStartedEvent();
      } else if (msg.type === 'mark') {
        markQueue.shift();
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
        responseStartTimestampTwilio = null;
        latestMediaTimestamp = 0;
      } else if (data.event === 'media' && data.media?.payload) {
        latestMediaTimestamp = data.media.timestamp;
        if (openAiWs.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: data.media.payload,
          }));
        } else {
          audioQueue.push(data.media.payload);
        }
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

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error('❌ Server error:', err);
    process.exit(1);
  }
  console.log(`🚀 Server listening on port ${PORT}`);
});
