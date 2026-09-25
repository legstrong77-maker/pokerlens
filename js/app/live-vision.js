// Shared camera + on-device detector for the scanner and the live analyst.
import { state } from './state.js';
import { CardDetector, MODELS, assignCards } from './detector.js';

const detectors = new Map(); // model id -> Promise<CardDetector|null>

/** Load (once) the configured on-device model. Resolves null when disabled or not installed. */
export function getDetector(onProgress) {
  const id = state.settings.detectModel || 'accurate';
  if (id === 'off' || !MODELS[id]) return Promise.resolve(null);
  if (!detectors.has(id)) {
    const p = (async () => {
      const head = await fetch(MODELS[id].url, { method: 'HEAD' }).catch(() => null);
      if (!head || !head.ok) return null;
      return new CardDetector(id).init({ onProgress, useGpu: !!state.settings.gpu });
    })();
    p.catch(() => detectors.delete(id));
    detectors.set(id, p);
  }
  return detectors.get(id);
}

export const hasCamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  return stream;
}

export function grabFrame(video) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}

/**
 * Turns noisy per-frame detections into a stable scene.
 * A card must appear in >= 2 of the last 4 frames; the (hero, board) split must stay the same
 * for `holdMs` before it is reported as stable.
 */
export class SceneStabilizer {
  constructor(holdMs = 1100) { this.hist = []; this.sig = ''; this.since = 0; this.holdMs = holdMs; }
  push(dets, now = performance.now()) {
    this.hist.push(dets);
    if (this.hist.length > 4) this.hist.shift();
    const count = new Map(), last = new Map();
    for (const f of this.hist) for (const d of f) { count.set(d.card, (count.get(d.card) || 0) + 1); last.set(d.card, d); }
    const need = Math.min(2, this.hist.length);
    const cards = [...count.entries()].filter(([, n]) => n >= need).map(([c]) => last.get(c));
    const split = assignCards(cards);
    const sig = `${split.hero.slice().sort().join(',')}|${split.board.join(',')}`;
    if (sig !== this.sig) { this.sig = sig; this.since = now; }
    return { dets: cards, ...split, sig, stable: now - this.since >= this.holdMs && cards.length > 0 };
  }
  reset() { this.hist = []; this.sig = ''; this.since = 0; }
}

/** Draw detection boxes over a <video>/<img> shown with object-fit cover/contain. */
export function drawBoxes(canvas, dets, src, { cover = true, heroSet = new Set(), boardSet = new Set(), label }) {
  const stage = canvas.parentElement;
  const W = stage.clientWidth, H = stage.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const sw = src.videoWidth || src.naturalWidth, sh = src.videoHeight || src.naturalHeight;
  if (!sw || !sh) return;
  const k = cover ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const ox = (W - sw * k) / 2, oy = (H - sh * k) / 2;
  ctx.lineWidth = 2.5;
  ctx.font = '700 14px -apple-system, system-ui, sans-serif';
  for (const d of dets) {
    const x = ox + d.box.x * sw * k, y = oy + d.box.y * sh * k, w = d.box.w * sw * k, h = d.box.h * sh * k;
    const col = heroSet.has(d.card) ? '#f0c46a' : boardSet.has(d.card) ? '#4fb6e8' : '#b7c2b9';
    ctx.strokeStyle = col;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8); else ctx.rect(x, y, w, h); ctx.stroke();
    const text = label ? label(d) : '';
    if (text) {
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = col; ctx.fillRect(x, Math.max(0, y - 21), tw, 19);
      ctx.fillStyle = '#10140f'; ctx.fillText(text, x + 5, Math.max(14, y - 7));
    }
  }
}
