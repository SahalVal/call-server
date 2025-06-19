import sox from 'sox-stream';
import { PassThrough } from 'stream';

/**
 * Convertit un buffer mulaw 8kHz (Twilio) en PCM16 8kHz (Promise)
 */
export function mulawToPcm16(mulawBuffer) {
  return new Promise((resolve, reject) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];

    input.end(mulawBuffer);

    input
      .pipe(sox({
        input: {
          type: 'raw',
          encoding: 'mulaw',
          bits: 8,
          rate: 8000,
          channels: 1,
        },
        output: {
          type: 'raw',
          encoding: 'signed-integer',
          bits: 16,
          rate: 8000,
          channels: 1,
          endian: 'little',
        }
      }))
      .pipe(output);

    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
}

/**
 * Upsample PCM16 8kHz => PCM16 24kHz (OpenAI input)
 */
export function resample8kTo24k(pcm16Buffer) {
  return new Promise((resolve, reject) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];

    input.end(pcm16Buffer);

    input
      .pipe(sox({
        input: {
          type: 'raw',
          encoding: 'signed-integer',
          bits: 16,
          rate: 8000,
          channels: 1,
          endian: 'little',
        },
        output: {
          type: 'raw',
          encoding: 'signed-integer',
          bits: 16,
          rate: 24000,
          channels: 1,
          endian: 'little',
        }
      }))
      .pipe(output);

    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
}

/**
 * Downsample PCM16 24kHz => PCM16 8kHz (OpenAI output)
 */
export function resample24kTo8k(pcm16Buffer) {
  return new Promise((resolve, reject) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];

    input.end(pcm16Buffer);

    input
      .pipe(sox({
        input: {
          type: 'raw',
          encoding: 'signed-integer',
          bits: 16,
          rate: 24000,
          channels: 1,
          endian: 'little',
        },
        output: {
          type: 'raw',
          encoding: 'signed-integer',
          bits: 16,
          rate: 8000,
          channels: 1,
          endian: 'little',
        }
      }))
      .pipe(output);

    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
}

/**
 * Convertit PCM16 8kHz en mulaw 8kHz (Twilio output)
 */
export function pcm16ToMulaw(pcm16Buffer) {
  return new Promise((resolve, reject) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];

    input.end(pcm16Buffer);

    input
      .pipe(sox({
        input: {
          type: 'raw',
          encoding: 'signed-integer',
          bits: 16,
          rate: 8000,
          channels: 1,
          endian: 'little',
        },
        output: {
          type: 'raw',
          encoding: 'mulaw',
          bits: 8,
          rate: 8000,
          channels: 1,
        }
      }))
      .pipe(output);

    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
}

/**
 * Conversion complète Twilio (mulaw base64) => OpenAI (pcm16 24kHz)
 */
export async function convertTwilioToOpenAI(mulawBase64) {
  const mulawBuffer = Buffer.from(mulawBase64, 'base64');
  const pcm8 = await mulawToPcm16(mulawBuffer);
  const pcm24 = await resample8kTo24k(pcm8);
  return pcm24;
}

/**
 * Conversion complète OpenAI (pcm16 24kHz) => Twilio (mulaw base64)
 */
export async function convertOpenAIToTwilio(pcm24Buffer) {
  const pcm8 = await resample24kTo8k(pcm24Buffer);
  const mulaw = await pcm16ToMulaw(pcm8);
  return mulaw.toString('base64');
}
