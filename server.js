const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SYSTEM_PROMPT = "Tu es un assistant commercial très sympathique et professionnel. Pose des questions ouvertes.";

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

async function createOpenAIRealtimeConnection() {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/realtime/sessions',
      {
        model: "gpt-4o-realtime-preview",
        modalities: ["audio"],
        voice: "nova",
        instructions: SYSTEM_PROMPT,
        temperature: 0.8,
        speed: 1.0,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    const token = response.data.client_secret.value;
    const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime/ws');

    return new Promise((resolve, reject) => {
      openaiWs.on('open', () => {
        openaiWs.send(JSON.stringify({
          type: 'session.authenticate',
          data: {
            token: token
          }
        }));
      });

      openaiWs.on('message', (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'session.confirmation') {
          console.log('Session Realtime OpenAI confirmée');
          resolve(openaiWs);
        } else if (parsed.type === 'session.error') {
          console.error('Erreur session OpenAI:', parsed.data.message);
          reject(new Error(parsed.data.message));
        }
      });

      openaiWs.on('error', reject);
    });

  } catch (err) {
    throw new Error('Erreur création session OpenAI Realtime: ' + err.message);
  }
}

wss.on('connection', async (twilioWs) => {
  console.log('Twilio connecté');
  let openaiWs;

  try {
    openaiWs = await createOpenAIRealtimeConnection();
  } catch (err) {
    console.error(err);
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
    } catch (err) {
      console.error('Erreur traitement OpenAI:', err);
    }
  });

  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'media' && msg.media?.payload) {
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({
            type: 'audio',
            data: msg.media.payload
          }));
        }
      } else if (msg.event === 'stop') {
        console.log('Stream terminé');
        openaiWs.close();
        twilioWs.close();
      }
    } catch (err) {
      console.error('Erreur traitement Twilio:', err);
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio fermé');
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });

  openaiWs.on('close', () => {
    console.log('OpenAI fermé');
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Serveur WebSocket en ligne sur le port 3000');
});
