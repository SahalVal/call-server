const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = "Tu es un assistant commercial très sympathique et professionnel. Pose des questions ouvertes.";
const MODEL = "gpt-4o-realtime-preview-2025-06-03";

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function createOpenAIConnection() {
  return new Promise((resolve, reject) => {
    const openaiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    openaiWs.on('open', () => {
      // Démarre la session avec les options
      openaiWs.send(JSON.stringify({
        type: "start",
        data: {
          model: MODEL,
          instructions: SYSTEM_PROMPT,
          voice: "nova",
          modalities: ["audio", "text"],
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 200,
            create_response: true,
            interrupt_response: true
          }
        }
      }));
      resolve(openaiWs);
    });

    openaiWs.on('error', (err) => reject(err));
  });
}

wss.on('connection', async (twilioWs) => {
  console.log('Twilio connecté');

  let openaiWs;

  try {
    openaiWs = await createOpenAIConnection();
    console.log('Connexion OpenAI établie');
  } catch (err) {
    console.error('Erreur connexion OpenAI:', err);
    twilioWs.close();
    return;
  }

  openaiWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'audio' && msg.data) {
        if (twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({
            event: 'media',
            media: { payload: msg.data },
          }));
        }
      }
    } catch (e) {
      console.error('Erreur traitement message OpenAI:', e);
    }
  });

  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'media' && msg.media?.payload) {
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({
            type: 'audio',
            data: msg.media.payload,
          }));
        }
      } else if (msg.event === 'stop') {
        console.log('Stream Twilio stopped');
        openaiWs.close();
        twilioWs.close();
      }
    } catch (e) {
      console.error('Erreur traitement message Twilio:', e);
    }
  });

  twilioWs.on('close', () => {
    console.log('Connexion Twilio fermée');
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  openaiWs.on('close', () => {
    console.log('Connexion OpenAI fermée');
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.close();
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Serveur WebSocket en ligne sur le port 3000');
});
