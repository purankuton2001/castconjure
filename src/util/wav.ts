/** Mock voice sample: a short, soft two-note chime (16 kHz mono PCM). Stands in for TTS output. */
export function mockVoiceWav(seconds = 2, sampleRate = 16000): Buffer {
  const n = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = t < 1 ? 440 : 523;
    const env = Math.min(1, t * 8) * Math.exp(-((t % 1) * 2.5));
    const v = Math.sin(2 * Math.PI * f * t + 0.3 * Math.sin(2 * Math.PI * 5 * t)) * env * 0.4;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
