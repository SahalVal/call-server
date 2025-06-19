// server.js
const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  console.log('Twilio connecté');

  ws.on('message', async data => {
    const msg = JSON.parse(data);

    if (msg.event === 'media') {
      const audioData = msg.media.payload;
      // TODO : envoyer ce son vers GPT-4o realtime
    }

    if (msg.event === 'start') {
      console.log('Appel démarré');
    }

    if (msg.event === 'stop') {
      console.log('Appel terminé');
    }
  });

  ws.on('close', () => {
    console.log('Connexion fermée');
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Serveur WebSocket démarré');
});
