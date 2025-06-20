import twilio from 'twilio';
import fetch from 'node-fetch';

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PHONE_NUMBER_FROM,
  DOMAIN,
  API_KEY,
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const DOMAIN_CLEAN = DOMAIN.replace(/(^\w+:|^)\/\//, '').replace(/\/+$|\/$/, '');

export const INTRO_TEXT = `Bonjour, je suis Emilie de LeguichetPro. Est-ce que vous avez un instant ? Je souhaiterais vous parler du label Expert Pro, qui valorise les professionnels reconnus et vous donne accès à des services dédiés.`;

const SYSTEM_MESSAGE = `Tu es un assistant vocal professionnel, féminin, prénommée Emilie. Tu appelles un professionnel pour lui présenter le label Expert PRO...\nLis exactement : "${INTRO_TEXT}"...`;

const outboundTwiML = (recordingCallbackUrl) => `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start><Record recordingStatusCallback="${recordingCallbackUrl}" /></Start>
  <Connect>
    <Stream url="wss://${DOMAIN_CLEAN}/media-stream" />
  </Connect>
</Response>`;

export async function handleCall(req, reply) {
  const to = req.body?.to;
  const token = req.headers.authorization || req.body.api_key;

  if (!to) return reply.status(400).send({ error: 'Missing "to"' });
  if (API_KEY && token !== `Bearer ${API_KEY}` && token !== API_KEY)
    return reply.status(401).send({ error: 'Unauthorized' });

  try {
    const call = await client.calls.create({
      from: PHONE_NUMBER_FROM,
      to,
      twiml: outboundTwiML('https://bridge.youzend.com/webhook/recording'),
    });
    return { message: 'Call initiated', sid: call.sid };
  } catch (err) {
    console.error('Call error:', err);
    return reply.status(500).send({ error: 'Call failed', details: err.message });
  }
}

export async function handleRecordingWebhook(req, reply) {
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
}
