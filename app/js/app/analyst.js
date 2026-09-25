// AI 即時分析師 — standalone live mode: camera + on-device detection keep the hand up to date,
// the engine answers instantly, and Claude (optional) reads the whole scene and explains the play.
import { state, emit, deriveSpot, boardCards, positionsFor } from './state.js';
import { $, esc, ICON, toast, haptic, miniCardHTML, cardText, fmtBB, pct, ACTION_ZH, ACTION_EN, openSheet, closeSheet } from './ui.js';
import { engineLatest } from './engine-client.js';
import { getDetector, hasCamera, startCamera, grabFrame, SceneStabilizer, drawBoxes } from './live-vision.js';
import { toJpegBlob, aiBackend, costUSD } from './claude-client.js';
import { askAnalyst, compactResult } from './ai-analyst.js';
import { onCardsChanged, newHandAction, trackerPanel, render as renderTable } from './table-view.js';
import * as TK from './tracker.js';
import { cardToString } from '../core/cards.js';
import { POS_SHORT, VILLAIN_TYPES } from '../core/charts.js';

let el = null, video = null, still = null, overlay = null, stream = null;
let detector = null, loopOn = false, stab = new SceneStabilizer();
let lastSplit = { hero: [], board: [], dets: [] };
let lastEngine = null, lastSpot = null, lastImage = null, backend = null;
let aiCtl = null, aiBusy = false, lastAiAt = 0, autoTimer = 0, thread = [], toolSpot = null;
let appliedSig = '';

const STREET_ZH = { preflop: '翻前', flop: '翻牌', turn: '轉牌', river: '河牌' };

export async function openAnalyst() {
  if (el) return;
  el = document.createElement('div');
  el.className = 'analyst';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'AI 即時分析師');
  el.innerHTML = `
    <div class="an-top">
      <button class="icon-btn" data-x="close" aria-label="關閉">${ICON.close}</button>
      <div style="flex:1;min-width:0"><div class="an-title">AI 即時分析師</div><div class="an-status" id="an-status">啟動中…</div></div>
      <button class="icon-btn" data-x="copy" aria-label="複製牌局給 Claude">${ICON.download}</button>
    </div>
    <div class="an-stage">
      <video playsinline muted autoplay></video>
      <img class="an-still" alt="" hidden>
      <canvas class="overlay"></canvas>
      <div class="an-nocam" hidden></div>
      <div class="an-scene" id="an-scene"></div>
      <div class="progress an-prog" id="an-prog" hidden><i></i></div>
    </div>
    <div class="an-body" id="an-body">
      <section class="an-card" id="an-hand"></section>
      <section class="an-card an-engine" id="an-engine"></section>
      <section class="an-card an-ai" id="an-ai"></section>
      <section id="an-track"></section>
    </div>
    <div class="an-bottom">
      <div class="an-row">
        <label class="an-auto"><span class="switch"><input type="checkbox" id="an-auto" ${state.settings.aiAuto ? 'checked' : ''}><i></i></span><span>自動分析</span></label>
        <button class="btn primary an-go" data-x="go">${ICON.spark}<span>分析現在</span></button>
      </div>
      <form class="an-ask" id="an-ask" autocomplete="off">
        <input class="kbd-input" id="an-q" placeholder="追問 AI，例如：如果他加注到 30 呢？" aria-label="追問 AI">
        <button class="btn" type="submit">送出</button>
      </form>
    </div>`;
  document.body.appendChild(el);
  video = $('video', el); still = $('.an-still', el); overlay = $('canvas.overlay', el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  $('#an-ask', el).addEventListener('submit', onAsk);
  backend = await aiBackend();
  renderHand(); renderAI(); renderTrack();
  await refreshEngine();
  startLive();
}

function close() {
  loopOn = false;
  aiCtl?.abort();
  clearTimeout(autoTimer);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  el?.remove(); el = null;
  renderTable();
}

const status = (m) => { const s = el && $('#an-status', el); if (s) s.textContent = m; };
function progress(p) {
  const bar = el && $('#an-prog', el);
  if (!bar) return;
  bar.hidden = p == null;
  if (p != null) bar.firstElementChild.style.width = `${Math.round(p * 100)}%`;
}

// ---------------------------------------------------------------- camera + detection
async function startLive() {
  const nocam = $('.an-nocam', el);
  if (hasCamera()) {
    try {
      stream = await startCamera(video);
      if (!el) { stream.getTracks().forEach((t) => t.stop()); return; }
    } catch (err) { stream = null; }
  }
  if (!stream) {
    video.hidden = true;
    nocam.hidden = false;
    nocam.innerHTML = `<div>這裡無法開啟即時相機。拍一張照片，AI 會讀出整個牌局。</div>
      <label class="btn primary">${ICON.camera}<span>拍照分析</span><input type="file" accept="image/*" capture="environment" hidden id="an-cap"></label>
      <label class="btn">${ICON.photo}<span>選擇照片</span><input type="file" accept="image/*" hidden id="an-pick"></label>`;
    nocam.querySelectorAll('input[type=file]').forEach((i) => i.addEventListener('change', onPhoto));
    status(backend ? `${backendLabel()} · 拍照後自動分析` : '拍照或手動輸入；設定 AI 後可讀整張照片');
    return;
  }
  status('載入辨識模型…');
  try {
    detector = await getDetector((p) => progress(p));
  } catch { detector = null; }
  progress(null);
  if (!el) return;
  if (!detector) { status(`${backendLabel()} · 未安裝裝置端模型：按「分析現在」用 AI 讀取畫面`); return; }
  status(`即時辨識中 · ${backendLabel()}`);
  loopOn = true;
  tick();
}

async function tick() {
  if (!loopOn || !el) return;
  if (video.readyState >= 2) {
    try {
      const dets = await detector.detect(video, { conf: 0.4, live: true });
      const sc = stab.push(dets);
      lastSplit = sc;
      drawBoxes(overlay, sc.dets, video, { cover: true, heroSet: new Set(sc.hero), boardSet: new Set(sc.board), label: (d) => cardText(d.card) });
      renderScene(sc);
      if (sc.stable && sc.sig !== appliedSig) applyScene(sc);
    } catch (e) { status('辨識暫停：' + (e.message || e)); }
  }
  setTimeout(tick, Math.max(150, (detector?.lastMs || 300) * 0.5));
}

function renderScene(sc) {
  const box = el && $('#an-scene', el);
  if (!box) return;
  const chips = [...sc.hero.map((c) => miniCardHTML(c, 'data-g="h"')), sc.board.length ? '<span class="an-sep"></span>' : '', ...sc.board.map((c) => miniCardHTML(c, 'data-g="b"'))].join('');
  box.innerHTML = chips || '<span class="an-hint">把手牌放在畫面下方、公牌在上方</span>';
}

/** Push a stable camera scene into the hand (new hand / new street) and re-analyse. */
function applyScene(sc) {
  appliedSig = sc.sig;
  const h = state.hand;
  let changed = false;
  const cur = h.hero.filter((c) => c >= 0).sort().join(',');
  if (sc.hero.length === 2 && sc.hero.slice().sort().join(',') !== cur) {
    if (h.hero[0] >= 0 && h.hero[1] >= 0) newHandAction(); // previous hand finished -> rotate seat, save history
    state.hand.hero = sc.hero.slice(0, 2);
    changed = true;
  }
  const hb = boardCards(state.hand);
  if (sc.board.length >= 3) {
    const prefixOk = hb.every((c, i) => sc.board[i] === c) || hb.length === 0;
    if (prefixOk && sc.board.length > hb.length) {
      state.hand.board = [0, 1, 2, 3, 4].map((i) => sc.board[i] ?? -1);
      changed = true;
    }
  }
  if (!changed) return;
  haptic();
  onCardsChanged();
  renderHand(); renderTrack();
  refreshEngine().then(() => scheduleAuto());
}

async function onPhoto(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  lastImage = await toJpegBlob(await blobToImage(f), 1280, 0.85);
  still.src = URL.createObjectURL(lastImage);
  still.hidden = false;
  $('.an-nocam', el).hidden = true;
  if (backend) runAI({ manual: true });
  else toast('尚未設定 AI：請在設定輸入 API 金鑰，或手動輸入牌');
}
function blobToImage(blob) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
}

// ---------------------------------------------------------------- hand / engine
function renderHand() {
  const box = el && $('#an-hand', el);
  if (!box) return;
  const h = state.hand, s = state.settings;
  const d = deriveSpot();
  const vt = VILLAIN_TYPES[s.villainType] || VILLAIN_TYPES.unknown;
  const board = boardCards(h);
  const pot = d.pot ?? d.track?.pot;
  const toCall = d.track ? d.track.toCall : d.cur?.facing !== 'none' ? (d.cur?.bet || 0) - (d.cur?.heroBet || 0) : 0;
  box.innerHTML = `
    <div class="an-hand-row">
      <div class="cards">${miniCardHTML(h.hero[0], 'data-slot="h0" role="button"')}${miniCardHTML(h.hero[1], 'data-slot="h1" role="button"')}</div>
      <div class="cards">${[0, 1, 2, 3, 4].map((i) => miniCardHTML(h.board[i], `data-slot="b${i}" role="button"`)).join('')}</div>
    </div>
    <div class="an-facts">
      <span class="pill hl">${esc(POS_SHORT[h.heroPos])}</span><span class="pill">${s.tableSize} 人 · ${s.stack} BB</span>
      <span class="pill">${STREET_ZH[d.street]}</span>
      ${pot != null ? `<span class="pill">底池 ${fmtBB(pot)}</span>` : ''}
      ${toCall > 0 ? `<span class="pill">需跟注 ${fmtBB(toCall)}</span>` : ''}
      <span class="pill">對手 ${esc(vt.short)}</span>
    </div>`;
}

async function refreshEngine() {
  const box = el && $('#an-engine', el);
  if (!box) return null;
  const d = deriveSpot();
  lastSpot = d.spot;
  const msg = (t, sub = '') => { box.innerHTML = `<div class="an-label">引擎建議</div><div class="an-wait"><b>${t}</b>${sub ? `<span>${sub}</span>` : ''}</div>`; };
  if (!d.ready) { lastEngine = null; msg('需要你的兩張手牌', '對準鏡頭或點上方牌格輸入'); return null; }
  if (d.tracker && d.track?.done) { lastEngine = null; msg(`${POS_SHORT[d.track.winner]} 贏得底池`, '其他人都棄牌了'); return null; }
  if (d.tracker && d.needBoard) { lastEngine = null; msg(`請發${['', '翻牌', '轉牌', '河牌'][d.needBoard]}`, '鏡頭看到公牌會自動填入'); return null; }
  if (d.tracker && d.track && !d.track.heroToAct && d.track.toAct) { lastEngine = null; msg(`等待 ${POS_SHORT[d.track.toAct]} 行動`, '在下方點選他的動作'); return null; }
  if (!d.spot) { lastEngine = null; msg('資訊不足'); return null; }
  box.innerHTML = `<div class="an-label">引擎建議 <span class="busy-dot"></span></div>`;
  try {
    const r = await engineLatest('analyst', 'analyze', d.spot);
    if (!r || !el) return null;
    lastEngine = r;
    const key = r.action.key;
    box.innerHTML = `
      <div class="an-label">引擎建議 <span class="hint">0.1 秒 · 離線</span></div>
      <div class="an-act k-${key}"><span class="w">${ACTION_ZH[key]}</span><span class="en">${ACTION_EN[key]}</span></div>
      <div class="an-size">${esc(r.action.label)}</div>
      <div class="an-nums"><span>勝率 <b>${pct(r.equity.value)}</b></span>${r.potOdds ? `<span>需要 <b>${pct(r.potOdds.required)}</b></span>` : ''}<span>${r.street === 'preflop' ? `起手前 ${Math.max(1, Math.round((r.handPercentile ?? 0.5) * 100))}%` : `SPR ${(r.spr ?? 0).toFixed(1)}`}</span></div>
      <ul class="reasons">${(r.reasons || []).slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    return r;
  } catch (e) { msg('無法分析', esc(e.message)); return null; }
}

// ---------------------------------------------------------------- AI analyst
function backendLabel() {
  if (backend === 'artifact') return 'AI：你的 Claude 帳號';
  if (backend === 'apikey') return `AI：${state.settings.aiModel || 'claude-opus-5'}`;
  return 'AI 未設定';
}

function renderAI(text = '', { busy = false, statusText = '', meta = '', error = '' } = {}) {
  const box = el && $('#an-ai', el);
  if (!box) return;
  if (!backend) {
    box.innerHTML = `<div class="an-label">AI 分析師</div><div class="an-wait"><b>尚未連接 Claude</b><span>在 claude.ai 開啟本 App 可直接用你的帳號；或到「設定」輸入 Anthropic API 金鑰。沒有 AI 時，上方引擎建議仍會即時運作。</span></div>`;
    return;
  }
  const lines = text.split('\n');
  const head = lines.find((l) => l.startsWith('建議')) || '';
  const body = lines.filter((l) => l !== head).join('\n');
  box.innerHTML = `
    <div class="an-label">AI 分析師 ${busy ? '<span class="busy-dot"></span>' : ''}<span class="hint">${esc(statusText)}</span></div>
    ${error ? `<p class="an-err">${esc(error)}</p>` : ''}
    ${head ? `<div class="an-ai-head">${esc(head)}</div>` : ''}
    ${text ? `<div class="an-ai-text">${esc(body || (head ? '' : text))}</div>` : busy ? '<div class="an-wait"><span>Claude 正在看牌桌…</span></div>' : '<div class="an-wait"><span>按「分析現在」或開啟「自動分析」：牌局有變化時自動請 AI 解讀。</span></div>'}
    ${toolSpot ? `<button class="chip" data-x="apply-ai" style="margin-top:10px">套用 AI 讀到的情況到牌桌</button>` : ''}
    ${meta ? `<div class="an-meta">${esc(meta)}</div>` : ''}`;
}

function scheduleAuto() {
  clearTimeout(autoTimer);
  if (!backend || !state.settings.aiAuto) return;
  const d = deriveSpot();
  if (!d.ready || !lastEngine) return;
  const wait = Math.max(1200, 9000 - (Date.now() - lastAiAt));
  autoTimer = setTimeout(() => runAI({ manual: false }), wait);
}

function appState() {
  const h = state.hand, s = state.settings, d = deriveSpot();
  const str = (arr) => arr.filter((c) => c >= 0).map(cardToString);
  return {
    table_size: s.tableSize, hero_position: h.heroPos, effective_stack_bb: d.effStack ?? s.stack,
    opponent_type: s.villainType, street: d.street,
    hero_cards: str(h.hero), board: str(boardCards(h)),
    pot_bb: d.pot ?? d.track?.pot ?? null,
    to_call_bb: d.track ? d.track.toCall : (d.cur?.facing !== 'none' ? (d.cur?.bet || 0) - (d.cur?.heroBet || 0) : 0),
    opponents_in_hand: d.track ? d.track.villains : (d.spot?.postflop?.villains ?? null),
    action_log: s.trackMode ? TK.describeTrack(h.track) : '（快速模式：未逐人紀錄）',
    camera_detected: { hero: lastSplit.hero.map(cardToString), board: lastSplit.board.map(cardToString) },
  };
}

async function runAI({ manual = false, question = '' } = {}) {
  if (!backend) { if (manual) toast('尚未設定 AI'); return; }
  clearTimeout(autoTimer);
  aiCtl?.abort();
  aiCtl = new AbortController();
  const ctl = aiCtl;
  aiBusy = true; lastAiAt = Date.now();
  if (!question) { thread = []; toolSpot = null; }
  let image = null;
  if (!question) {
    if (stream && video.readyState >= 2) image = await toJpegBlob(grabFrame(video), 1280, 0.85);
    else image = lastImage;
  }
  renderAI('', { busy: true, statusText: question ? '回答追問…' : '讀取牌桌…' });
  let shown = '';
  try {
    const res = await askAnalyst({
      image, appState: appState(), engineResult: compactResult(lastEngine), baseSpot: lastSpot, question,
      history: thread, signal: ctl.signal,
      onText: (t) => { shown = t; if (ctl === aiCtl) renderAI(t, { busy: true, statusText: '回覆中…' }); },
      onStatus: (m) => { if (ctl === aiCtl) renderAI(shown, { busy: true, statusText: m }); },
      onToolSpot: (sp) => { if (spotDiffers(sp, lastSpot)) toolSpot = sp; },
    });
    if (ctl !== aiCtl) return;
    const meta = res.usage ? `${res.model} · ${res.usage.input + res.usage.output} tokens · 約 US$${res.cost.toFixed(3)}` : `${backendLabel()}`;
    renderAI(res.text, { meta });
  } catch (e) {
    if (ctl !== aiCtl) return;
    renderAI(shown, { error: e.message || String(e) });
  } finally {
    if (ctl === aiCtl) aiBusy = false;
  }
}

async function onAsk(e) {
  e.preventDefault();
  const q = $('#an-q', el).value.trim();
  if (!q) return;
  $('#an-q', el).value = '';
  if (!backend) { toast('尚未設定 AI'); return; }
  runAI({ manual: true, question: q });
}

// ---------------------------------------------------------------- actions (tracker) + events
function renderTrack() {
  const box = el && $('#an-track', el);
  if (!box) return;
  if (!state.settings.trackMode) {
    box.innerHTML = `<div class="an-card"><div class="an-label">下注動作</div><p class="hint" style="margin:6px 0 0">目前是「快速」模式。到牌桌畫面輸入對手下注，或切換成「逐人紀錄」在這裡直接點選。</p><button class="chip" data-x="to-track" style="margin-top:8px">切換成逐人紀錄</button></div>`;
    return;
  }
  box.innerHTML = trackerPanel(deriveSpot());
}

async function afterStateChange() {
  emit('hand');
  renderHand(); renderTrack();
  await refreshEngine();
  scheduleAuto();
}

async function onClick(e) {
  const b = e.target.closest('[data-x],[data-act],[data-slot]');
  if (!b || !el.contains(b)) return;
  haptic();
  const h = state.hand;
  const x = b.dataset.x, a = b.dataset.act;
  if (x === 'close') return close();
  if (x === 'go') return runAI({ manual: true });
  if (x === 'copy') return copyHand();
  if (x === 'to-track') { state.settings.trackMode = true; return afterStateChange(); }
  if (x === 'apply-ai' && toolSpot) return applyToolSpot();
  if (b.dataset.slot) {
    const { openPicker } = await import('./picker.js');
    return openPicker(b.dataset.slot, () => { onCardsChanged(); renderHand(); renderTrack(); refreshEngine().then(scheduleAuto); });
  }
  if (!a) return;
  if (a === 'tk') TK.act(h.track, b.dataset.k, b.dataset.to ? +b.dataset.to : undefined);
  else if (a === 'tk-undo') TK.undo(h.track);
  else if (a === 'tk-reset') { const { resetTrack } = await import('./state.js'); resetTrack(); }
  else if (a === 'tk-foldto') TK.foldToHero(h.track);
  else if (a === 'tk-custom') {
    const amt = parseFloat($('#tk-amt', el)?.value);
    if (!(amt > 0)) { toast('請輸入金額（BB）'); return; }
    TK.act(h.track, 'raise', amt);
  } else if (a === 'tk-next') {
    TK.nextStreet(h.track);
    const t = TK.state(h.track);
    const need = [0, 3, 4, 5][t.street];
    if (boardCards(h).length < need) toast(`請發${['', '翻牌', '轉牌', '河牌'][t.street]}：對準鏡頭或點牌格`);
  } else if (a === 'newhand') { newHandAction(); }
  else return;
  h.override = null;
  await afterStateChange();
}

function onChange(e) {
  if (e.target.id === 'an-auto') {
    state.settings.aiAuto = e.target.checked;
    emit('settings');
    if (e.target.checked) scheduleAuto(); else clearTimeout(autoTimer);
  }
}

/** Did the AI read a different situation than the one the app already has? */
function spotDiffers(a, b) {
  if (!b) return true;
  const cards = (x) => (x || []).join(',');
  if (cards(a.hero) !== cards(b.hero) || cards(a.board) !== cards(b.board) || a.heroPos !== b.heroPos) return true;
  const A = a.postflop, B = b.postflop;
  if (!A || !B) return !!A !== !!B;
  return Math.abs((A.pot || 0) - (B.pot || 0)) > 0.5 || A.facing !== B.facing || Math.abs((A.bet || 0) - (B.bet || 0)) > 0.5 || (A.villains || 1) !== (B.villains || 1);
}

/** Copy AI-corrected values (board / pot / amount to call) into the hand. */
function applyToolSpot() {
  const sp = toolSpot, h = state.hand;
  if (sp.hero?.length === 2) h.hero = sp.hero.slice();
  if (sp.board?.length >= 3) h.board = [0, 1, 2, 3, 4].map((i) => sp.board[i] ?? -1);
  if (sp.heroPos && positionsFor(state.settings.tableSize).includes(sp.heroPos)) h.heroPos = sp.heroPos;
  const n = boardCards(h).length;
  const street = n >= 5 ? 'river' : n === 4 ? 'turn' : n === 3 ? 'flop' : 'preflop';
  if (sp.postflop && street !== 'preflop') {
    const P = sp.postflop;
    h.override = { street, pot: P.pot + (P.facing !== 'none' ? P.bet : 0), toCall: P.facing !== 'none' ? P.bet : 0, villains: P.villains };
  }
  toolSpot = null;
  onCardsChanged();
  renderHand(); renderTrack(); refreshEngine();
  toast('已套用 AI 讀到的情況');
}

async function copyHand() {
  const h = state.hand, s = state.settings, d = deriveSpot();
  const str = (arr) => arr.filter((c) => c >= 0).map(cardText).join(' ') || '—';
  const r = lastEngine;
  const text = [
    `【牌局】${s.tableSize} 人桌 · 有效籌碼 ${s.stack} BB · 我在 ${h.heroPos} · 對手類型 ${s.villainType}`,
    `【手牌】${str(h.hero)}　【公牌】${str(boardCards(h))}　（${STREET_ZH[d.street]}）`,
    s.trackMode ? `【動作】\n${TK.describeTrack(h.track)}` : '',
    r ? `【引擎建議】${r.action.label}｜勝率 ${pct(r.equity.value)}${r.potOdds ? `｜需要 ${pct(r.potOdds.required)}` : ''}\n${(r.reasons || []).map((x) => '・' + x).join('\n')}` : '',
    '請以職業德撲教練的角度深入分析這手牌：我的打法、對手可能的範圍、每條街更好的選擇。',
  ].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(text); toast('已複製，可貼到 Claude 深入分析'); }
  catch {
    openSheet(`<h3>複製牌局</h3><div class="sub">長按選取全部後複製</div><textarea class="kbd-input" style="min-height:220px" readonly>${esc(text)}</textarea><button class="btn block" style="margin-top:12px" data-x="done">完成</button>`, {
      onMount(sh) { const t = sh.querySelector('textarea'); t.focus(); t.select(); sh.querySelector('[data-x="done"]').onclick = () => closeSheet(); },
    });
  }
}
