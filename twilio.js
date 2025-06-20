// ✅ Correction du bug ESM vs CommonJS pour Twilio
import twilioPkg from 'twilio';
import fetch from 'node-fetch';

const { VoiceResponse } = twilioPkg;
const client = twilioPkg(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const {
  PHONE_NUMBER_FROM,
  DOMAIN,
  API_KEY,
} = process.env;

const DOMAIN_CLEAN = DOMAIN.replace(/(^\w+:|^)\/\//, '').replace(/\/+$|\/$/, '');

export const INTRO_TEXT = `Bonjour, je suis Emilie de LeguichetPro. Est-ce que vous avez un instant ? Je souhaiterais vous parler du label Expert Pro, qui valorise les professionnels reconnus et vous donne accès à des services dédiés.`;

export const SYSTEM_MESSAGE = `
Tu es un assistant vocal professionnel, féminin, prénommée Emilie. Tu appelles un professionnel pour lui présenter le label Expert PRO, lancé par Le Guichet Pro : le guichet unique des entreprises, déjà utilisé par plus de 100 000 professionnels en France.

Le Guichet Pro aide les entreprises à se développer via la génération de leads, l’accompagnement, et des services comme la conciergerie ou les achats pros. Le label Expert PRO référence uniquement des professionnels, et les met en avant auprès d’autres professionnels de leur secteur. Il permet d’être reconnu comme l’expert référent dans sa zone, d’attirer plus de clients professionnels qualifiés et de gagner en crédibilité.

L’objectif de ton appel est d’ouvrir la discussion, puis de proposer d’envoyer un lien par WhatsApp ou email pour que le prospect puisse vérifier en quelques secondes s'il reste des places pour rejoindre le label. Tu ne vends rien, tu proposes un premier pas.

Important : Commence toujours chaque appel par la phrase suivante, mot pour mot, sans jamais rien ajouter, ni changer, ni omettre. Attends d’avoir fini la phrase avant d’écouter l’autre personne.
Lis exactement : "${INTRO_TEXT}"

Adopte un ton naturel, chaleureux, enthousiaste, positif et professionnel. Parle rapidement mais articule, marque des pauses naturelles, ta voix doit être fluide et naturelle, pas robotique du tout. Après la phrase d’intro, attends la réponse de ton interlocuteur avant de poursuivre.
`.trim();

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
      url: `https://${DOMAIN_CLEAN}/twiml`,
      record: true,
      recordingStatusCallback: 'https://bridge.youzend.com/webhook/recording',
    });
    return { message: 'Call initiated', sid: call.sid };
  } catch (err) {
    console.error('📞❌ Call error:', err);
    return reply.status(500).send({ error: 'Call failed', details: err.message });
  }
}

export async function serveTwiML(req, reply) {
  const twiml = new VoiceResponse();
  twiml.start().record({ recordingStatusCallback: 'https://bridge.youzend.com/webhook/recording' });
  twiml.connect().stream({ url: `wss://${DOMAIN_CLEAN}/media-stream` });

  reply.type('text/xml');
  reply.send(twiml.toString());
}

export async function handleRecordingWebhook(req, reply) {
  const recordingUrl = req.body?.RecordingUrl;
  const callSid = req.body?.CallSid;

  if (!recordingUrl || !callSid) {
    return reply.status(400).send({ error: 'Missing recording data' });
  }

  try {
    await fetch('https://bridge.youzend.com/webhook/recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, recordingUrl }),
    });
    reply.send({ status: 'Recording forwarded' });
  } catch (error) {
    console.error('🔁 Error forwarding recording:', error);
    reply.status(500).send({ error: 'Failed to forward recording' });
  }
}
