// Browser-side module for the H3 Max Director probe (bundled by esbuild, run in headless Chrome by director-probe.mjs).
// Opens a realtime WebRTC session, records the received audio+video with MediaRecorder, logs every server message.
import { createFalClient } from '@fal-ai/client';
import { wma } from '@fal-ai/client/realtime';

window.directorRun = async function directorRun(cfg) {
  const log = (ev, data) => window.__log && window.__log(JSON.stringify({ t: Date.now(), ev, ...(data || {}) }));
  const fal = createFalClient({ credentials: cfg.key });
  let imageUrl = null;
  if (cfg.imageDataUrl) {
    try {
      const blob = await (await fetch(cfg.imageDataUrl)).blob();
      imageUrl = await fal.storage.upload(new File([blob], 'frame.png', { type: 'image/png' }));
      log('uploaded', { imageUrl });
    } catch (e) { log('upload_failed', { error: String(e) }); }
  }
  const video = document.querySelector('video');
  let recorder = null; const chunks = [];
  const session = fal.realtime.open(wma(cfg.endpoint), {
    receive: ['video', 'audio'],
    onMedia: (stream) => {
      video.srcObject = stream; video.muted = true; video.play().catch(() => {});
      log('media', { tracks: stream.getTracks().map((t) => t.kind) });
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 4_000_000 });
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.start(1000);
        log('recording_started');
      } catch (e) { log('recorder_failed', { error: String(e) }); }
    },
    onData: (raw) => { try { const m = typeof raw === 'string' ? JSON.parse(raw) : raw; log('msg', { m }); } catch { log('msg_raw', { raw: String(raw).slice(0, 300) }); } },
    onState: (state) => log('state', { state }),
    onError: (error) => log('error', { error: String(error && error.message ? error.message : error) }),
  });
  window.directorSession = session;
  window.directorSend = (msg) => { log('send', { msg }); session.send(msg); };
  window.directorStop = async () => {
    try { session.send({ type: 'stop' }); } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    if (recorder && recorder.state !== 'inactive') { await new Promise((r) => { recorder.onstop = r; recorder.stop(); }); }
    try { await session.close(); } catch {}
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  // configure
  const configure = { type: 'configure', protocol_version: 1, prompt: cfg.prompt, prompt_version: 1, seed: cfg.seed ?? null, resolution: cfg.resolution || '480p', aspect_ratio: '16:9', memory: cfg.memory || 12 };
  if (imageUrl) configure.image_url = imageUrl;
  // wait for the connection to be ready before configuring (states vary by SDK version; retry a few times)
  await new Promise((r) => setTimeout(r, 1500));
  window.directorSend(configure);
  return { imageUrl };
};
