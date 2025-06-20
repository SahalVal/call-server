import WebSocket from 'ws';
const { OPENAI_API_KEY, VOICE = 'alloy' } = process.env;

export function setupWebSocket(connection) {
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
      connection.socket.send(JSON.stringify({ event: 'clear', streamSid }));
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
        instructions: require('./twilio.js').SYSTEM_MESSAGE,
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
        connection.socket.send(JSON.stringify({ event: 'media', streamSid, media: { payload: msg.delta } }));
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

  connection.socket.on('message', (msg) => {
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

  connection.socket.on('close', () => {
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
    console.log('⛔️ Twilio stream closed');
  });

  openAiWs.on('error', (e) => console.error('OpenAI WebSocket error:', e));
  openAiWs.on('close', () => console.log('🔒 OpenAI WebSocket closed'));
}
