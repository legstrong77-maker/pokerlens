// On-device playing-card detector (YOLOv8/YOLO11 ONNX, corner-index classes) via onnxruntime-web.
import { parseCard } from '../core/cards.js';

const ORT_VER = '1.30.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;

// Roboflow "Playing Cards" (augmented-startups/playing-cards-ow27d) class order.
export const ROBOFLOW_NAMES = [
  '10C', '10D', '10H', '10S', '2C', '2D', '2H', '2S', '3C', '3D', '3H', '3S', '4C', '4D', '4H', '4S',
  '5C', '5D', '5H', '5S', '6C', '6D', '6H', '6S', '7C', '7D', '7H', '7S', '8C', '8D', '8H', '8S',
  '9C', '9D', '9H', '9S', 'AC', 'AD', 'AH', 'AS', 'JC', 'JD', 'JH', 'JS', 'KC', 'KD', 'KH', 'KS',
  'QC', 'QD', 'QH', 'QS',
];

export const MODELS = {
  fast: {
    id: 'fast', label: '快速', desc: 'YOLO11n · 10.6 MB · 適合即時掃描',
    url: 'models/cards-fast.onnx', input: 640, live: 640, names: ROBOFLOW_NAMES,
  },
  accurate: {
    id: 'accurate', label: '高精度', desc: 'YOLO11s · 真實牌桌影片訓練 · 較慢',
    url: 'models/cards-accurate.onnx', input: 640, live: 480, names: ROBOFLOW_NAMES,
  },
};

let ortPromise = null;
function loadOrt(useGpu) {
  if (window.ort) return Promise.resolve(window.ort);
  if (!ortPromise) {
    ortPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ORT_BASE + (useGpu ? 'ort.webgpu.min.js' : 'ort.wasm.min.js');
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        const ort = window.ort;
        if (!ort) return reject(new Error('辨識引擎載入失敗'));
        ort.env.wasm.wasmPaths = ORT_BASE;
        ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
        resolve(ort);
      };
      s.onerror = () => { ortPromise = null; reject(new Error('無法下載辨識引擎（需要網路一次）')); };
      document.head.appendChild(s);
    });
  }
  return ortPromise;
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`模型下載失敗 (${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export class CardDetector {
  constructor(modelId = 'fast') {
    this.model = MODELS[modelId] || MODELS.fast;
    this.session = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.lastMs = 0;
    this.backend = '';
  }

  async init({ onProgress, useGpu = false } = {}) {
    const ort = await loadOrt(useGpu);
    const bytes = await fetchWithProgress(this.model.url, onProgress);
    const providers = useGpu && navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
    this.session = await ort.InferenceSession.create(bytes, { executionProviders: providers, graphOptimizationLevel: 'all' });
    this.backend = providers[0];
    this.inputName = this.session.inputNames[0];
    this.outputName = this.session.outputNames[0];
    return this;
  }

  /** Letterbox a drawable into size x size; returns tensor + transform. */
  prep(src, S = this.model.input) {
    const w0 = src.videoWidth || src.naturalWidth || src.width;
    const h0 = src.videoHeight || src.naturalHeight || src.height;
    const k = Math.min(S / w0, S / h0);
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const dx = Math.floor((S - w) / 2), dy = Math.floor((S - h) / 2);
    this.canvas.width = S; this.canvas.height = S;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgb(114,114,114)';
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(src, dx, dy, w, h);
    const px = ctx.getImageData(0, 0, S, S).data;
    const n = S * S;
    const f = new Float32Array(3 * n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      f[i] = px[p] / 255; f[n + i] = px[p + 1] / 255; f[2 * n + i] = px[p + 2] / 255;
    }
    return { data: f, k, dx, dy, w0, h0, S };
  }

  /** Detect cards. Returns card-level detections [{card, name, score, box:{x,y,w,h} normalized 0..1}] */
  async detect(src, { conf = 0.4, iou = 0.5, live = false } = {}) {
    if (!this.session) throw new Error('模型尚未載入');
    const t0 = performance.now();
    const ort = window.ort;
    const P = this.prep(src, live ? this.model.live : this.model.input);
    const input = new ort.Tensor('float32', P.data, [1, 3, P.S, P.S]);
    const out = await this.session.run({ [this.inputName]: input });
    const t = out[this.outputName];
    const raw = decode(t, this.model.names, P, conf);
    const kept = nms(raw, iou);
    this.lastMs = performance.now() - t0;
    return mergeCorners(kept);
  }
}

function decode(t, names, P, conf) {
  const d = t.dims, data = t.data;
  const dets = [];
  const nc = names.length;
  const toBox = (cx, cy, w, h) => {
    const x = (cx - w / 2 - P.dx) / P.k, y = (cy - h / 2 - P.dy) / P.k;
    return { x: x / P.w0, y: y / P.h0, w: w / P.k / P.w0, h: h / P.k / P.h0 };
  };
  if (d.length === 3 && d[1] === 4 + nc) { // [1, 4+nc, N] (YOLOv8 / YOLO11 raw)
    const N = d[2];
    for (let i = 0; i < N; i++) {
      let best = 0, bc = -1;
      for (let c = 0; c < nc; c++) { const v = data[(4 + c) * N + i]; if (v > best) { best = v; bc = c; } }
      if (best < conf) continue;
      dets.push({ cls: bc, score: best, box: toBox(data[i], data[N + i], data[2 * N + i], data[3 * N + i]) });
    }
  } else if (d.length === 3 && d[2] === 4 + nc) { // [1, N, 4+nc]
    const N = d[1], st = 4 + nc;
    for (let i = 0; i < N; i++) {
      let best = 0, bc = -1;
      for (let c = 0; c < nc; c++) { const v = data[i * st + 4 + c]; if (v > best) { best = v; bc = c; } }
      if (best < conf) continue;
      dets.push({ cls: bc, score: best, box: toBox(data[i * st], data[i * st + 1], data[i * st + 2], data[i * st + 3]) });
    }
  } else if (d.length === 3 && d[2] === 6) { // [1, N, 6] post-NMS: x1,y1,x2,y2,score,cls
    const N = d[1];
    for (let i = 0; i < N; i++) {
      const s = data[i * 6 + 4];
      if (s < conf) continue;
      const x1 = data[i * 6], y1 = data[i * 6 + 1], x2 = data[i * 6 + 2], y2 = data[i * 6 + 3];
      dets.push({ cls: data[i * 6 + 5] | 0, score: s, box: toBox((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1) });
    }
  }
  for (const x of dets) { x.name = names[x.cls]; x.card = parseCard(x.name); }
  return dets.filter((x) => x.card >= 0);
}

function iouOf(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-9);
}
function nms(dets, thr) {
  dets.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of dets) {
    if (keep.some((k) => iouOf(k.box, d.box) > thr)) continue; // class-agnostic: one corner, one label
    keep.push(d);
  }
  return keep;
}
/** One card may show two corner indices: merge boxes of the same class into one card. */
function mergeCorners(dets) {
  const byCard = new Map();
  for (const d of dets) {
    const e = byCard.get(d.card);
    if (!e) byCard.set(d.card, { card: d.card, name: d.name, score: d.score, box: { ...d.box }, n: 1 });
    else {
      const b = e.box;
      const x1 = Math.min(b.x, d.box.x), y1 = Math.min(b.y, d.box.y);
      const x2 = Math.max(b.x + b.w, d.box.x + d.box.w), y2 = Math.max(b.y + b.h, d.box.y + d.box.h);
      // corners of one card are close; far-apart duplicates = mis-detection, keep the stronger
      if ((x2 - x1) < 0.45 && (y2 - y1) < 0.6) e.box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      e.score = Math.max(e.score, d.score); e.n++;
    }
  }
  return [...byCard.values()].sort((a, b) => b.score - a.score);
}

/**
 * Split detections into hero (2) and board (<=5) using first-person geometry:
 * the board is the widest horizontal row of cards; hole cards are the remaining cards,
 * preferring the lowest (nearest the camera) and largest.
 */
export function assignCards(dets) {
  const cs = dets.map((d) => ({ ...d, cx: d.box.x + d.box.w / 2, cy: d.box.y + d.box.h / 2, s: Math.max(d.box.w, d.box.h) }));
  if (cs.length <= 2) return { hero: cs.map((c) => c.card), board: [], extra: [] };
  const hs = cs.map((c) => c.box.h).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)] || 0.1;
  let bestRow = [];
  for (const c of cs) {
    const row = cs.filter((o) => Math.abs(o.cy - c.cy) < Math.max(0.04, med * 0.6));
    if (row.length > bestRow.length || (row.length === bestRow.length && avg(row, 'cy') < avg(bestRow, 'cy'))) bestRow = row;
  }
  let board = bestRow.length >= 3 ? bestRow : [];
  let rest = cs.filter((c) => !board.includes(c));
  if (!board.length) { // no clear row: two lowest are hero, rest board
    const sorted = cs.slice().sort((a, b) => b.cy - a.cy);
    rest = sorted.slice(0, 2); board = sorted.slice(2);
  }
  board = board.sort((a, b) => a.cx - b.cx);
  rest = rest.sort((a, b) => (b.cy + b.s) - (a.cy + a.s));
  const hero = rest.slice(0, 2);
  const extra = [...rest.slice(2), ...board.slice(5)];
  return { hero: hero.map((c) => c.card), board: board.slice(0, 5).map((c) => c.card), extra: extra.map((c) => c.card) };
}
const avg = (arr, k) => (arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : 1);

/** Temporal smoothing for live video: a card must be seen in >= 2 of the last 4 frames. */
export class Tracker {
  constructor() { this.hist = []; }
  push(dets) {
    this.hist.push(dets);
    if (this.hist.length > 4) this.hist.shift();
    const count = new Map(), last = new Map();
    for (const f of this.hist) for (const d of f) { count.set(d.card, (count.get(d.card) || 0) + 1); last.set(d.card, d); }
    const need = Math.min(2, this.hist.length);
    return [...count.entries()].filter(([, n]) => n >= need).map(([c]) => last.get(c));
  }
  reset() { this.hist = []; }
}
