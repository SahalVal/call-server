// audioUtils.js
import SoxCommand from 'sox-audio';

/**
 * Convertit un buffer mulaw 8kHz (Twilio) en PCM16 8kHz
 */
export function mulawToPcm16(mulawBuffer) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    const cmd = SoxCommand();

    cmd.inputStream()
      .inputFormat('mulaw')
      .inputEncoding('mu-law')
      .inputSampleRate(8000)
      .inputChannels(1)

      .outputStream()
      .outputFormat('raw') // PCM16 LE
      .outputEncoding('signed-integer')
      .outputBits(16)
      .outputSampleRate(8000)
      .outputChannels(1)

      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)))
      .start();

    cmd.inputStream().end(mulawBuffer);

    cmd.outputStream().on('data', (chunk) => {
      chunks.push(chunk);
    });
  });
}

/**
 * Upsample PCM16 8kHz => PCM16 24kHz (OpenAI input)
 */
export function resample8kTo24k(pcm16Buffer) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    const cmd = SoxCommand();

    cmd.inputStream()
      .inputFormat('raw')
      .inputEncoding('signed-integer')
      .inputBits(16)
      .inputSampleRate(8000)
      .inputChannels(1)

      .outputStream()
      .outputFormat('raw')
      .outputEncoding('signed-integer')
      .outputBits(16)
      .outputSampleRate(24000)
      .outputChannels(1)

      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)))
      .start();

    cmd.inputStream().end(pcm16Buffer);

    cmd.outputStream().on('data', (chunk) => {
      chunks.push(chunk);
    });
  });
}

/**
 * Downsample PCM16 24kHz => PCM16 8kHz (OpenAI output)
 */
export function resample24kTo8k(pcm16Buffer) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    const cmd = SoxCommand();

    cmd.inputStream()
      .inputFormat('raw')
      .inputEncoding('signed-integer')
      .inputBits(16)
      .inputSampleRate(24000)
      .inputChannels(1)

      .outputStream()
      .outputFormat('raw')
      .outputEncoding('signed-integer')
      .outputBits(16)
      .outputSampleRate(8000)
      .outputChannels(1)

      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)))
      .start();

    cmd.inputStream().end(pcm16Buffer);

    cmd.outputStream().on('data', (chunk) => {
      chunks.push(chunk);
    });
  });
}

/**
 * Convertit PCM16 8kHz en mulaw 8kHz (Twilio output)
 */
export function pcm16ToMulaw(pcm16Buffer) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    const cmd = SoxCommand();

    cmd.inputStream()
      .inputFormat('raw')
      .inputEncoding('signed-integer')
      .inputBits(16)
      .inputSampleRate(8000)
      .inputChannels(1)

      .outputStream()
      .outputFormat('mulaw')
      .outputEncoding('mu-law')
      .outputSampleRate(8000)
      .outputChannels(1)

      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)))
      .start();

    cmd.inputStream().end(pcm16Buffer);

    cmd.outputStream().on('data', (chunk) => {
      chunks.push(chunk);
    });
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
