// server.js
import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import axios from 'axios';
import {
  convertTwilioToOpenAI,
  convertOpenAIToTwilio,
} from './audioUtils.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_URL = 'https://api.openai.com/v1/realtime/sessions';
const OPENAI_WS_BASE_URL = 'wss://api.openai.com/v1/realtime';

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/stream' });

async function createOpenAISession() {
  const body = {
    model: 'gpt-4o-realtime-preview',
    modalities: ['audio', 'text'],
    instructions: 'Tu es un assistant commercial très sympathique et professionnel.',
    voice: 'nova',
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 200,
      create_response: true,
      interrupt_response: true,
    },
    temperature: 0.8,
    max_response_output_tokens: 200,
    speed: 1,
    tool_choice: 'auto',
  };

  const response = await axios.post(OPENAI_REALTIME_URL, body, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  return response.data;
}

function connectToOpenAIWebSocket(session) {
  return new Promise((resolve, reject) => {
    const wsUrl = `${OPENAI_WS_BASE_URL}?model=${session.model}`;
    const ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    ws.on('open', () => {
      console.log('Connexion WebSocket OpenAI établie');
      resolve(ws);
    });

    ws.on('error', (err) => {
      reject(err);
    });

    ws.on('close', (code, reason) => {
      console.log(`Connexion WebSocket OpenAI fermée, code=${code}, raison=${reason.toString()}`);
    });
  });
}

wss.on('connection', async (twilioWs) => {
  console.log('Twilio connecté');

  let openaiWs = null;
  let openaiSession = null;

  try {
    openaiSession = await createOpenAISession();
    openaiWs = await connectToOpenAIWebSocket(openaiSession);
  } catch (err) {
    console.error('Erreur création session ou connexion OpenAI:', err);
    twilioWs.close();
    return;
  }

  let streamSid = null;

  twilioWs.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.event) {
        case 'connected':
          console.log('Twilio stream connecté, protocol:', msg.protocol);
          break;

        case 'start':
          streamSid = msg.streamSid;
          console.log('Stream démarré, streamSid:', streamSid);
          break;

        case 'media':
          if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
            // Conversion audio avant envoi OpenAI
            const openaiAudio = await convertTwilioToOpenAI(msg.media.payload);
            openaiWs.send(openaiAudio);
          }
          break;

        case 'stop':
          console.log('Stream stoppé par Twilio');
          if (openaiWs) openaiWs.close();
          twilioWs.close();
          break;

        case 'dtmf':
          console.log('DTMF reçu:', msg.dtmf.digit);
          break;

        default:
          console.log('Message Twilio non traité:', msg.event);
      }
    } catch (e) {
      console.error('Erreur traitement message Twilio:', e);
    }
  });

  openaiWs.on('message', async (data) => {
    try {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'text') {
          console.log('Texte OpenAI:', msg.data);
        }
      } else {
        if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
          // Conversion audio avant renvoi Twilio
          const twilioAudio = await convertOpenAIToTwilio(data);
          if (twilioAudio.length > 0) {
            twilioWs.send(
              JSON.stringify({
                event: 'media',
                streamSid,
                media: { payload: twilioAudio },
              }),
            );
          }
        }
      }
    } catch (e) {
      console.error('Erreur traitement message OpenAI:', e);
    }
  });

  openaiWs.on('close', () => {
    console.log('Connexion OpenAI fermée');
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
  });

  twilioWs.on('close', () => {
    console.log('Connexion Twilio fermée');
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });

  openaiWs.on('error', (err) => {
    console.error('Erreur OpenAI WS:', err);
  });

  twilioWs.on('error', (err) => {
    console.error('Erreur Twilio WS:', err);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Serveur WebSocket en ligne sur le port 3000');
});
