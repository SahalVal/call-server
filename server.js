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
    // 1. Créer la session realtime chez OpenAI
    const response = await axios.post(
      'https://api.openai.com/v1/realtime/sessions',
      {
        model: "gpt-4o-realtime-preview",
        modalities: ["audio", "text"],
        instructions: SYSTEM_PROMPT,
        voice: "nova"
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );
    const session = response.data;
    console.log('Session OpenAI créée, id:', session.id);

    // 2. Connexion websocket à OpenAI avec le token de session
    return new Promise((resolve, reject) => {
      const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime', {
        headers: {
          Authorization: `Bearer ${session.client_secret.value}`,
        }
      });

      openaiWs.on('open', () => {
        console.log('WebSocket OpenAI ouvert');
        resolve(openaiWs);
      });

      openaiWs.on('error', (err) => {
        reject(err);
      });
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
    console.error(err.message);
    twilioWs.close();
    return;
  }

  openaiWs.on('message', (data) => {
    // OpenAI envoie la réponse audio (base64) dans un message JSON
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'media' && msg.media?.payload) {
        console.log('Message audio reçu de OpenAI, taille:', msg.media.payload.length);
        // Renvoi vers Twilio
        if (twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({
            event: 'media',
            media: { payload: msg.media.payload }
          }));
          console.log('Message audio envoyé à Twilio');
        }
      }
      if (msg.event === 'stop') {
        console.log('OpenAI a envoyé stop');
        twilioWs.close();
      }
    } catch (e) {
      console.error('Erreur traitement message OpenAI:', e.message);
    }
  });

  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'media' && msg.media?.payload) {
        console.log('Message audio reçu de Twilio, taille:', msg.media.payload.length);
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({
            event: 'media',
            media: { payload: msg.media.payload }
          }));
          console.log('Message audio envoyé à OpenAI');
        }
      } else if (msg.event === 'stop') {
        console.log('Stream Twilio stopped');
        openaiWs.close();
        twilioWs.close();
      }
    } catch (e) {
      console.error('Erreur traitement message Twilio:', e.message);
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
