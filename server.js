const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  console.log('Twilio connecté');
  ws.on('message', data => {
    console.log('Reçu :', data);
    // Ici tu pourras ajouter GPT-4o plus tard
  });
  ws.on('close', () => console.log('Connexion fermée'));
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Serveur WebSocket en ligne sur le port 3000');
});
