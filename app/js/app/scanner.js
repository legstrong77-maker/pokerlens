// Camera scanner: live on-device detection, photo / video analysis, and Claude AI reading.
import { state, emit } from './state.js';
import { $, esc, ICON, toast, haptic, miniCardHTML, cardText } from './ui.js';
import { CardDetector, assignCards, Tracker, MODELS } from './detector.js';
import { aiAvailable, readTable } from './vision-ai.js';

let el = null, stream = null, video = null, still = null, overlay = null;
let detector = null, detectorState = 'idle'; // idle | loading | ready | missing | error
let loopOn = false, tracker = new Tracker();
let found = { hero: [], board: [], extra: [] };
let lastDets = [];
let onDone = null;
let aiCtl = null;
let mode = 'live'; // live | still

const hasCamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;

export async function openScanner(cb) {
  onDone = cb;
  if (el) return;
  found = { hero: [], board: [], extra: [] };
  tracker.reset();
  el = document.createElement('div');
  el.className = 'scanner';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '掃描牌面');
  el.innerHTML = `
    <div class="stage">
      <video playsinline muted autoplay></video>
      <img class="still" alt="" hidden style="object-fit:contain">
      <div class="zones" aria-hidden="true"><div class="zone board">公牌區</div><div class="zone hand">手牌區</div></div>
      <canvas class="overlay"></canvas>
      <div class="nocam" hidden style="position:absolute;inset:0;display:grid;place-content:center;gap:12px;padding:24px;text-align:center;color:var(--ink-2)"></div>
    </div>
    <div class="top">
      <button class="icon-btn" data-x="close" aria-label="關閉">${ICON.close}</button>
      <div style="flex:1;min-width:0"><div class="title">掃描牌面</div><div class="status" id="sc-status">準備相機…</div></div>
      <button class="icon-btn" data-x="flip" aria-label="重新掃描" title="重新掃描">${ICON.reset}</button>
    </div>
    <div class="bottom">
      <div class="scan-found">
        <div class="grp"><span>手牌</span><div class="cards" id="sc-hero"></div></div>
        <div class="grp"><span>公牌</span><div class="cards" id="sc-board"></div></div>
      </div>
      <div class="scan-actions">
        <label class="btn" style="min-height:50px">${ICON.photo}<span>相簿</span><input type="file" id="sc-file" accept="image/*,video/*" hidden></label>
        <button class="shutter" data-x="shoot" aria-label="拍照辨識"><i></i></button>
        <button class="btn primary" data-x="apply" style="min-height:50px">${ICON.check}<span>套用</span></button>
      </div>
      <div class="row" style="justify-content:center;margin-top:12px;gap:8px">
        <button class="chip" data-x="ai" id="sc-ai" hidden>${'✦'} AI 精準辨識</button>
        <button class="chip" data-x="manual">手動選牌</button>
      </div>
      <div class="progress" id="sc-prog" hidden style="margin-top:10px"><i></i></div>
      <div class="scan-note" id="sc-note">點牌可在「手牌 / 公牌」之間移動；長按移除</div>
    </div>`;
  document.body.appendChild(el);
  video = $('video', el); still = $('.still', el); overlay = $('canvas.overlay', el);
  el.addEventListener('click', onClick);
  $('#sc-file', el).addEventListener('change', onFile);
  bindChipPress();
  renderFound();
  aiAvailable().then((b) => { const a = $('#sc-ai', el); if (a) a.hidden = !b; });
  startCamera();
  loadDetector();
}

function close() {
  loopOn = false;
  aiCtl?.abort();
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  el?.remove(); el = null;
}

function status(msg) { const s = el && $('#sc-status', el); if (s) s.textContent = msg; }
function note(msg) { const s = el && $('#sc-note', el); if (s) s.textContent = msg; }
function progress(p) {
  const bar = el && $('#sc-prog', el);
  if (!bar) return;
  bar.hidden = p == null;
  if (p != null) bar.firstElementChild.style.width = `${Math.round(p * 100)}%`;
}

async function startCamera() {
  const nocam = $('.nocam', el);
  if (!hasCamera()) return showNoCam('此環境無法直接開啟相機（需要 HTTPS 或 App 權限）。可以拍照或上傳照片／影片辨識。');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (!el) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    nocam.hidden = true;
    mode = 'live';
    status(detectorState === 'ready' ? '即時辨識中…把公牌放在上方框、手牌放在下方框' : '對準牌面後按快門');
    startLoop();
  } catch (err) {
    showNoCam(err && err.name === 'NotAllowedError' ? '相機權限被拒絕。可到 iPhone「設定 → Safari → 相機」允許，或改用拍照上傳。' : '無法開啟相機，改用拍照或上傳照片。');
  }
}

function showNoCam(msg) {
  const nocam = $('.nocam', el);
  video.hidden = true;
  nocam.hidden = false;
  nocam.innerHTML = `<div style="font-size:15px">${esc(msg)}</div>
    <label class="btn primary" style="justify-self:center">${ICON.camera}<span>拍照</span><input type="file" accept="image/*" capture="environment" hidden id="sc-cap"></label>
    <label class="btn" style="justify-self:center">${ICON.video}<span>選擇照片或影片</span><input type="file" accept="image/*,video/*" hidden id="sc-cap2"></label>`;
  nocam.querySelectorAll('input[type=file]').forEach((i) => i.addEventListener('change', onFile));
  status('拍照或上傳辨識');
}

async function loadDetector() {
  const pref = state.settings.detectModel || 'fast';
  if (pref === 'off') { detectorState = 'missing'; return; }
  if (detector && detectorState === 'ready' && detector.model.id === pref) return;
  detectorState = 'loading';
  status('載入辨識模型…');
  progress(0);
  try {
    // check the model file exists before pulling the runtime
    const head = await fetch(MODELS[pref].url, { method: 'HEAD' }).catch(() => null);
    if (!head || !head.ok) { detectorState = 'missing'; progress(null); status(stream ? '對準牌面後按快門（可用 AI 辨識）' : '拍照或上傳辨識'); note('尚未安裝裝置端辨識模型：請用「AI 精準辨識」或手動選牌'); return; }
    detector = await new CardDetector(pref).init({ onProgress: (p) => progress(p * 0.9), useGpu: !!state.settings.gpu });
    detectorState = 'ready';
    progress(null);
    status(stream ? '即時辨識中…公牌放上方框、手牌放下方框' : '拍照或上傳辨識');
    if (stream) startLoop();
  } catch (err) {
    detectorState = 'error';
    progress(null);
    status('辨識模型載入失敗');
    note(String(err.message || err));
  }
}

function startLoop() {
  if (loopOn || detectorState !== 'ready' || !stream) return;
  loopOn = true;
  const tick = async () => {
    if (!loopOn || !el || mode !== 'live') return;
    if (video.readyState >= 2) {
      try {
        const dets = await detector.detect(video, { conf: 0.4, live: true });
        const stable = tracker.push(dets);
        lastDets = stable;
        found = assignCards(stable);
        draw(stable, video);
        renderFound();
        status(`即時辨識 · ${stable.length} 張 · ${Math.round(detector.lastMs)} ms`);
      } catch (e) { status('辨識暫停：' + (e.message || e)); }
    }
    setTimeout(tick, Math.max(120, detector ? detector.lastMs * 0.6 : 200));
  };
  tick();
}

// ---------- drawing ----------
function draw(dets, src) {
  const stage = overlay.parentElement;
  const W = stage.clientWidth, H = stage.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  overlay.width = W * dpr; overlay.height = H * dpr;
  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const sw = src.videoWidth || src.naturalWidth, sh = src.videoHeight || src.naturalHeight;
  if (!sw || !sh) return;
  const cover = src === video;
  const k = cover ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const ox = (W - sw * k) / 2, oy = (H - sh * k) / 2;
  const heroSet = new Set(found.hero), boardSet = new Set(found.board);
  ctx.lineWidth = 2.5;
  ctx.font = '700 15px -apple-system, system-ui, sans-serif';
  for (const d of dets) {
    const x = ox + d.box.x * sw * k, y = oy + d.box.y * sh * k, w = d.box.w * sw * k, h = d.box.h * sh * k;
    const col = heroSet.has(d.card) ? '#f0c46a' : boardSet.has(d.card) ? '#4fb6e8' : '#b7c2b9';
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 8) : ctx.rect(x, y, w, h); ctx.stroke();
    const label = `${cardText(d.card)} ${Math.round(d.score * 100)}%`;
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = col; ctx.fillRect(x, y - 22, tw, 20);
    ctx.fillStyle = '#10140f'; ctx.fillText(label, x + 5, y - 7);
  }
}

// ---------- found cards ----------
function renderFound() {
  if (!el) return;
  const chips = (arr, grp) => (arr.length ? arr.map((c) => miniCardHTML(c, `data-card="${c}" data-grp="${grp}" role="button" tabindex="0" aria-label="${cardText(c)}，點一下移到${grp === 'hero' ? '公牌' : '手牌'}"`)).join('') : '<span class="hint">—</span>');
  $('#sc-hero', el).innerHTML = chips(found.hero, 'hero');
  $('#sc-board', el).innerHTML = chips(found.board, 'board');
}
function bindChipPress() {
  let timer = 0, longFired = false;
  const start = (e) => {
    const t = e.target.closest('[data-card]');
    if (!t) return;
    longFired = false;
    timer = setTimeout(() => {
      longFired = true;
      const c = +t.dataset.card;
      found.hero = found.hero.filter((x) => x !== c);
      found.board = found.board.filter((x) => x !== c);
      haptic(); renderFound(); freeze();
    }, 550);
  };
  const end = () => clearTimeout(timer);
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', end);
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', end);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-card]');
    if (!t || longFired) return;
    const c = +t.dataset.card;
    if (t.dataset.grp === 'hero') { found.hero = found.hero.filter((x) => x !== c); if (found.board.length < 5) found.board.push(c); }
    else { found.board = found.board.filter((x) => x !== c); if (found.hero.length < 2) found.hero.push(c); else { const out = found.hero.shift(); found.hero.push(c); found.board.push(out); } }
    haptic(); renderFound(); freeze();
  }, true);
}
/** Stop the live loop so manual edits are not overwritten. */
function freeze() { if (mode === 'live' && loopOn) { mode = 'still'; loopOn = false; status('已暫停即時辨識（按重新掃描繼續）'); } }

// ---------- actions ----------
async function onClick(e) {
  const b = e.target.closest('[data-x]');
  if (!b) return;
  haptic();
  const x = b.dataset.x;
  if (x === 'close') return close();
  if (x === 'manual') { close(); import('./picker.js').then((m) => m.openPicker('h0', onDone)); return; }
  if (x === 'flip') { // resume live scanning
    still.hidden = true; video.hidden = !stream; mode = 'live'; tracker.reset();
    $('.zones', el).hidden = !stream;
    found = { hero: [], board: [], extra: [] }; renderFound(); draw([], video);
    if (stream) { status('即時辨識中…'); startLoop(); } else status('拍照或上傳辨識');
    return;
  }
  if (x === 'shoot') return shoot();
  if (x === 'ai') return runAI();
  if (x === 'apply') return apply();
}

async function shoot() {
  if (!stream || video.readyState < 2) { $('#sc-cap', el)?.click() || $('#sc-file', el).click(); return; }
  // freeze current frame into the still image
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.92);
  await showStill(url);
  if (detectorState === 'ready') await detectStill();
  else if (await aiAvailable()) runAI();
  else note('沒有裝置端模型：請用「手動選牌」或在設定加入 AI 金鑰');
}

async function showStill(url) {
  mode = 'still'; loopOn = false;
  still.src = url;
  await new Promise((r) => { if (still.complete && still.naturalWidth) r(); else still.onload = r; });
  still.hidden = false; video.hidden = true;
  $('.nocam', el).hidden = true;
  $('.zones', el).hidden = true;
}

async function detectStill() {
  status('辨識中…');
  try {
    const dets = await detector.detect(still, { conf: 0.35 });
    lastDets = dets;
    found = assignCards(dets);
    draw(dets, still);
    renderFound();
    status(`找到 ${dets.length} 張牌 · ${Math.round(detector.lastMs)} ms`);
    if (dets.length < 2 && !$('#sc-ai', el).hidden) note('辨識到的牌太少，試試「AI 精準辨識」或靠近一點重拍');
  } catch (err) { status('辨識失敗：' + (err.message || err)); }
}

async function onFile(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.type.startsWith('video/')) return analyzeVideo(f);
  const url = URL.createObjectURL(f);
  await showStill(url);
  if (detectorState === 'loading') { status('等待模型載入…'); await waitFor(() => detectorState !== 'loading', 30000); }
  if (detectorState === 'ready') await detectStill();
  else if (await aiAvailable()) runAI(f);
  else note('沒有裝置端模型：請用「手動選牌」或在設定加入 AI 金鑰');
}

async function analyzeVideo(file) {
  mode = 'still'; loopOn = false;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = URL.createObjectURL(file);
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('無法讀取影片')); });
  const dur = v.duration || 0;
  const n = Math.max(4, Math.min(16, Math.round(dur / 0.5)));
  const agg = new Map();
  let lastFrameUrl = null;
  status(`分析影片（${dur.toFixed(1)} 秒）…`);
  if (detectorState === 'loading') await waitFor(() => detectorState !== 'loading', 30000);
  for (let i = 0; i < n; i++) {
    const t = Math.min(dur - 0.05, (dur * (i + 0.5)) / n);
    await seek(v, t);
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    lastFrameUrl = c.toDataURL('image/jpeg', 0.9);
    progress((i + 1) / n);
    if (detectorState === 'ready') {
      const dets = await detector.detect(c, { conf: 0.4 });
      const wgt = 1 + i / n; // later frames weigh more (board grows over time)
      for (const d of dets) {
        const e = agg.get(d.card) || { d, w: 0 };
        e.w += wgt; e.d = d; agg.set(d.card, e);
      }
    }
  }
  progress(null);
  await showStill(lastFrameUrl);
  if (detectorState === 'ready') {
    const thr = Math.max(1, n * 0.25);
    const dets = [...agg.values()].filter((e) => e.w >= thr).map((e) => e.d);
    lastDets = dets;
    found = assignCards(dets);
    draw(dets, still);
    renderFound();
    status(`影片分析完成 · ${dets.length} 張牌`);
  } else if (await aiAvailable()) runAI();
  else note('沒有裝置端模型：請用「手動選牌」或在設定加入 AI 金鑰');
}
function seek(v, t) { return new Promise((res) => { v.onseeked = () => res(); v.currentTime = t; }); }
function waitFor(cond, ms) { return new Promise((res) => { const t0 = Date.now(); const it = setInterval(() => { if (cond() || Date.now() - t0 > ms) { clearInterval(it); res(); } }, 100); }); }

async function runAI(file) {
  const btn = $('#sc-ai', el);
  aiCtl?.abort();
  aiCtl = new AbortController();
  let src = file || null;
  if (!src) {
    if (mode === 'live' && stream && video.readyState >= 2) {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      await showStill(c.toDataURL('image/jpeg', 0.92));
    }
    src = still;
  }
  btn && (btn.disabled = true);
  status('Claude 正在讀取牌面…（約 5–20 秒）');
  note('AI 會同時嘗試讀出底池與下注金額');
  try {
    const r = await readTable(src, { signal: aiCtl.signal });
    found = { hero: r.hero, board: r.board, extra: [] };
    renderFound();
    draw([], still);
    const extra = [];
    if (r.pot != null) extra.push(`底池 ${r.pot}`);
    if (r.toCall != null) extra.push(`需跟注 ${r.toCall}`);
    if (r.players != null) extra.push(`${r.players} 人在局`);
    status(`AI 辨識完成（信心：${{ high: '高', medium: '中', low: '低' }[r.confidence]}）`);
    note([r.notes, extra.join(' · ')].filter(Boolean).join(' ｜ ') || '請確認結果後按「套用」');
    state._aiExtra = { pot: r.pot, toCall: r.toCall };
  } catch (err) {
    status('AI 辨識失敗');
    note(err.message || String(err));
  } finally {
    btn && (btn.disabled = false);
  }
}

function apply() {
  const h = state.hand;
  if (!found.hero.length && !found.board.length) { toast('還沒有辨識到牌'); return; }
  const hero = found.hero.slice(0, 2);
  const board = found.board.slice(0, 5);
  if (board.length && board.length < 3) { toast('公牌需要 3 張以上，已略過公牌'); }
  if (hero.length) { h.hero = [hero[0] ?? -1, hero[1] ?? -1]; }
  if (board.length >= 3) h.board = [0, 1, 2, 3, 4].map((i) => board[i] ?? -1);
  // ensure no duplicates between hero and board
  const seen = new Set();
  h.hero = h.hero.map((c) => (c >= 0 && !seen.has(c) ? (seen.add(c), c) : -1));
  h.board = h.board.map((c) => (c >= 0 && !seen.has(c) ? (seen.add(c), c) : -1));
  emit('hand');
  close();
  toast(`已套用：手牌 ${hero.map(cardText).join(' ') || '—'}${board.length >= 3 ? ` ｜ 公牌 ${board.map(cardText).join(' ')}` : ''}`);
  onDone && onDone();
}
