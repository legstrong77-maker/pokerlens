// Preflop range explorer: RFI, vs open (3-bet/call), vs 3-bet, push/fold (Nash).
import { state, emit, positionsBefore, positionsAfter } from './state.js';
import {
  positionsFor, POS_LABEL, POS_SHORT, rfiRange, vsOpenRanges, vs3betRanges, pushRange, playersBehind,
} from '../core/charts.js';
import { rangeWidth, rangeToString } from '../core/ranges.js';
import { eqVsRandom, solvePushFold } from '../core/preflop.js';
import { className, classOfCards } from '../core/cards.js';
import { esc, haptic, pct } from './ui.js';

const R = 'AKQJT98765432';
let root = null;
const view = { mode: 'rfi', pos: null, opener: null, stack: 10, sel: -1 };

export function mountRanges(el) {
  root = el;
  root.addEventListener('click', onClick);
  render();
}

function colors(mode) {
  return {
    raise: 'var(--a-bet)', call: 'var(--a-call)', allin: 'var(--a-allin)', fold: '#18221e',
  };
}

function cellStyle(r, c) {
  // r: raise freq, c: call freq -> split cell (raise from left, then call, rest fold)
  const rp = Math.round(r * 100), cp = Math.round(c * 100);
  if (rp + cp <= 0) return '';
  const A = view.mode === 'push' ? '#e2477d' : '#f3a93b';
  return `background:linear-gradient(90deg, ${A} 0 ${rp}%, #4fb6e8 ${rp}% ${rp + cp}%, #18221e ${rp + cp}% 100%);color:#10140f`;
}

function current() {
  const s = state.settings, size = s.tableSize;
  const list = positionsFor(size);
  let pos = view.pos && list.includes(view.pos) ? view.pos : (list.includes(state.hand.heroPos) ? state.hand.heroPos : list[0]);
  view.pos = pos;
  let raise = new Float32Array(169), call = new Float32Array(169), title = '', note = '';
  if (view.mode === 'rfi') {
    if (pos === 'BB') { pos = 'SB'; view.pos = 'SB'; }
    raise = rfiRange(pos, size);
    title = `${POS_SHORT[pos]} 開池（Raise First In）`;
    note = `後面還有 ${size === 2 ? 1 : playersBehind(pos, size)} 人 · 開池範圍約 ${pct(rangeWidth(raise), 1)}`;
  } else if (view.mode === 'vsopen') {
    const before = positionsBefore(pos, size);
    if (!before.length) { const p2 = list[list.length - 1]; view.pos = p2; return current(); }
    const op = view.opener && before.includes(view.opener) ? view.opener : before[before.length - 1];
    view.opener = op;
    const r = vsOpenRanges(op, pos, size);
    raise = r.raise; call = r.call;
    title = `${POS_SHORT[pos]} 面對 ${POS_SHORT[op]} 開池`;
    note = `3-bet ${pct(rangeWidth(raise), 1)} · 跟注 ${pct(rangeWidth(call), 1)} · 棄牌 ${pct(1 - rangeWidth(raise) - rangeWidth(call), 0)}`;
  } else if (view.mode === 'vs3bet') {
    if (pos === 'BB') { view.pos = 'SB'; return current(); }
    const r = vs3betRanges(pos, size);
    raise = r.raise; call = r.call;
    title = `${POS_SHORT[pos]} 開池後面對 3-bet`;
    note = `4-bet ${pct(rangeWidth(raise), 1)} · 跟注 ${pct(rangeWidth(call), 1)}（佔全部手牌）`;
  } else if (view.mode === 'push') {
    if (pos === 'BB') { view.pos = 'SB'; return current(); }
    const p = pushRange(pos, size, view.stack, s.ante);
    raise = p.range;
    title = `${POS_SHORT[pos]} 推擠/棄牌 · ${view.stack} BB`;
    note = `Nash 均衡（${pos === 'SB' || size === 2 ? '小盲對大盲精確解' : '依後方人數估算'}）· 全下範圍 ${pct(p.width, 1)}`;
  } else if (view.mode === 'call') {
    const nash = solvePushFold(view.stack, s.ante);
    call = nash.call;
    title = `大盲跟注小盲全下 · ${view.stack} BB`;
    note = `Nash 均衡跟注範圍 ${pct(rangeWidth(call), 1)}`;
  }
  return { pos, raise, call, title, note, list };
}

function render() {
  if (!root) return;
  const s = state.settings, size = s.tableSize;
  const cur = current();
  const hero = state.hand.hero;
  const heroCls = hero[0] >= 0 && hero[1] >= 0 ? classOfCards(hero[0], hero[1]) : -1;
  const modes = [['rfi', '開池'], ['vsopen', '面對開池'], ['vs3bet', '面對 3-bet'], ['push', '推擠'], ['call', '跟注全下']];
  let posList = cur.list;
  if (view.mode === 'rfi' || view.mode === 'vs3bet' || view.mode === 'push') posList = posList.filter((p) => p !== 'BB');
  if (view.mode === 'vsopen') posList = posList.filter((p) => positionsBefore(p, size).length > 0);
  if (view.mode === 'call') posList = [];
  let cells = '';
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const c = i * 13 + j;
    const name = i === j ? R[i] + R[j] : i < j ? R[i] + R[j] + 's' : R[j] + R[i] + 'o';
    const r = cur.raise[c] || 0, cl = cur.call[c] || 0;
    cells += `<button class="cell ${c === heroCls ? 'hero' : ''} ${c === view.sel ? 'hero' : ''}" data-cell="${c}" style="${cellStyle(r, cl)}" aria-label="${name}"><span>${name}</span></button>`;
  }
  const sel = view.sel >= 0 ? view.sel : heroCls;
  let detail = '';
  if (sel >= 0) {
    const r = cur.raise[sel] || 0, c = cur.call[sel] || 0;
    const actR = view.mode === 'push' ? '全下' : view.mode === 'vsopen' ? '3-bet' : view.mode === 'vs3bet' ? '4-bet' : '加注';
    detail = `<div class="panel" style="margin-top:12px"><div class="row" style="justify-content:space-between">
      <div><div style="font-family:var(--f-display);font-weight:800;font-size:28px">${className(sel)}</div>
      <div class="hint">對 1 人隨機 ${pct(eqVsRandom(sel, 1))} · 對 3 人 ${pct(eqVsRandom(sel, 3))}</div></div>
      <div style="text-align:right">${r > 0 ? `<div class="pill hl">${actR} ${pct(r, 0)}</div>` : ''}${c > 0 ? `<div class="pill" style="margin-top:4px">跟注 ${pct(c, 0)}</div>` : ''}${r + c < 0.01 ? '<div class="pill">棄牌</div>' : ''}</div></div></div>`;
  }
  const legend = view.mode === 'push'
    ? `<span><i style="background:#e2477d"></i>全下</span><span><i style="background:#18221e;border:1px solid var(--line-2)"></i>棄牌</span>`
    : view.mode === 'call' ? `<span><i style="background:#4fb6e8"></i>跟注</span><span><i style="background:#18221e;border:1px solid var(--line-2)"></i>棄牌</span>`
    : `<span><i style="background:#f3a93b"></i>${view.mode === 'rfi' ? '加注' : view.mode === 'vsopen' ? '3-bet' : '4-bet'}</span>${view.mode !== 'rfi' ? '<span><i style="background:#4fb6e8"></i>跟注</span>' : ''}<span><i style="background:#18221e;border:1px solid var(--line-2)"></i>棄牌</span>`;
  root.innerHTML = `
    <div class="section-title" style="margin-top:6px"><span>翻前範圍表</span><span class="en">${size}-MAX · ${s.stack}BB</span></div>
    <div class="chips scroll">${modes.map(([k, l]) => `<button class="chip ${view.mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>
    ${posList.length ? `<div class="row" style="margin-top:10px"><label>位置</label><div class="chips scroll">${posList.map((p) => `<button class="chip ${p === cur.pos ? 'on' : ''}" data-pos="${p}">${POS_SHORT[p]}</button>`).join('')}</div></div>` : ''}
    ${view.mode === 'vsopen' ? `<div class="row" style="margin-top:10px"><label>開池者</label><div class="chips scroll">${positionsBefore(cur.pos, size).map((p) => `<button class="chip ${p === view.opener ? 'on' : ''}" data-opener="${p}">${POS_SHORT[p]}</button>`).join('')}</div></div>` : ''}
    ${view.mode === 'push' || view.mode === 'call' ? `<div class="row" style="margin-top:10px"><label>籌碼</label><div class="chips scroll">${[3, 5, 7, 8, 10, 12, 15, 20].map((v) => `<button class="chip ${view.stack === v ? 'on' : ''}" data-stack="${v}">${v}<small>BB</small></button>`).join('')}</div></div>` : ''}
    <div class="panel">
      <div style="font-weight:700">${esc(cur.title)}</div>
      <div class="hint" style="margin:2px 0 10px">${esc(cur.note)}</div>
      <div class="rgrid" role="grid" aria-label="13x13 起手牌表">${cells}</div>
      <div class="legend-row">${legend}<span class="hint">分色 = 混合頻率</span></div>
    </div>
    ${detail}
    <details class="panel more"><summary><div class="row" style="justify-content:space-between"><b style="font-size:14px">範圍文字</b><span class="hint">展開 ›</span></div></summary>
      <p class="mono" style="font-size:12px;color:var(--ink-2);word-break:break-word;margin:10px 0 0">${esc(rangeToString(cur.raise))}${rangeWidth(cur.call) > 0 ? `<br><br>跟注：${esc(rangeToString(cur.call))}` : ''}</p></details>
    <p class="disclaimer" style="margin:14px 2px">範圍為 100BB 現金局求解器結果的近似值，並依「設定」中的桌型與籌碼深度調整。推擠/棄牌由內建 Nash 求解器即時計算。</p>`;
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b || !root.contains(b)) return;
  haptic();
  if (b.dataset.mode) { view.mode = b.dataset.mode; view.sel = -1; }
  else if (b.dataset.pos) view.pos = b.dataset.pos;
  else if (b.dataset.opener) view.opener = b.dataset.opener;
  else if (b.dataset.stack) view.stack = +b.dataset.stack;
  else if (b.dataset.cell) view.sel = +b.dataset.cell === view.sel ? -1 : +b.dataset.cell;
  else return;
  render();
}
