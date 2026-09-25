// Tools: multi-way equity calculator, outs & odds table, pot-odds calculator, hand history.
import { state, emit } from './state.js';
import { engine } from './engine-client.js';
import { pickOne } from './picker.js';
import { esc, haptic, miniCardHTML, pct, fmtBB, cardText, toast, ICON } from './ui.js';
import { parseRange, rangeWidth } from '../core/ranges.js';
import { POS_SHORT } from '../core/charts.js';

let root = null;
const calc = {
  players: [
    { cards: [-1, -1], range: '' },
    { cards: [-1, -1], range: '' },
  ],
  board: [-1, -1, -1, -1, -1],
  result: null,
  busy: false,
};
const po = { pot: 10, bet: 5 };
let tab = 'equity';

export function mountTools(el) {
  root = el;
  // seed calculator with the current hand
  const h = state.hand;
  if (h.hero[0] >= 0 && h.hero[1] >= 0) calc.players[0].cards = h.hero.slice();
  calc.board = h.board.slice();
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  render();
}

function used() {
  const u = new Set();
  for (const p of calc.players) for (const c of p.cards) if (c >= 0) u.add(c);
  for (const c of calc.board) if (c >= 0) u.add(c);
  return u;
}

function render() {
  if (!root) return;
  const tabs = [['equity', '勝率計算'], ['odds', 'Outs 機率'], ['potodds', '底池賠率'], ['history', '手牌紀錄']];
  let body = '';
  if (tab === 'equity') body = equityHTML();
  else if (tab === 'odds') body = oddsHTML();
  else if (tab === 'potodds') body = potOddsHTML();
  else body = historyHTML();
  root.innerHTML = `
    <div class="section-title" style="margin-top:6px"><span>工具</span><span class="en">TOOLS</span></div>
    <div class="chips scroll">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-tab2="${k}">${l}</button>`).join('')}</div>
    ${body}`;
}

// ---------- equity calculator ----------
function equityHTML() {
  const res = calc.result;
  const rows = calc.players.map((p, i) => {
    const r = res && res[i];
    const isRange = !(p.cards[0] >= 0 && p.cards[1] >= 0) && p.range;
    return `<div class="eq-player">
      <div>
        <div class="row" style="gap:8px"><b style="font-size:13px;color:var(--ink-3)">玩家 ${i + 1}${i === 0 ? '（你）' : ''}</b>
          ${calc.players.length > 2 && i > 0 ? `<button class="chip" data-rm="${i}" style="min-height:26px;padding:2px 8px">移除</button>` : ''}</div>
        <div class="cards" style="margin-top:6px">${miniCardHTML(p.cards[0], `data-pc="${i}:0" role="button" tabindex="0"`)}${miniCardHTML(p.cards[1], `data-pc="${i}:1" role="button" tabindex="0"`)}
          <input class="kbd-input" style="min-height:36px;width:150px;padding:6px 10px;font-size:13px" data-range="${i}" placeholder="或範圍：QQ+, AK" value="${esc(p.range)}" aria-label="玩家 ${i + 1} 範圍"></div>
        ${isRange ? `<div class="hint" style="margin-top:4px">範圍約 ${pct(rangeWidth(parseRange(p.range)), 1)} 的手牌</div>` : ''}
      </div>
      <div class="res">${r ? `<div class="v num">${(r.equity * 100).toFixed(1)}%</div><div class="d">勝 ${pct(r.win, 1)} · 平 ${pct(r.tie, 1)}</div>` : `<div class="v" style="color:var(--ink-3)">—</div><div class="d">${p.cards[0] >= 0 && p.cards[1] >= 0 ? '' : p.range ? '範圍' : '隨機'}</div>`}</div>
    </div>`;
  }).join('');
  const boardRow = calc.board.map((c, i) => miniCardHTML(c, `data-bc="${i}" role="button" tabindex="0"`)).join('');
  return `
    <div class="panel">
      <div class="row" style="justify-content:space-between"><b>公牌</b><button class="chip" data-x="clearboard">清除</button></div>
      <div class="cards" style="display:flex;gap:6px;margin-top:8px">${boardRow}</div>
    </div>
    <div class="eq-players" style="margin-top:10px">${rows}</div>
    <div class="btn-row" style="margin-top:10px">
      ${calc.players.length < 6 ? `<button class="btn" data-x="addp">${ICON.plus}新增玩家</button>` : ''}
      <button class="btn primary" data-x="calc">${calc.busy ? '計算中…' : '計算勝率'}</button>
    </div>
    <p class="hint" style="margin-top:10px">點牌格選牌；未指定手牌的玩家可輸入範圍（如 <span class="mono">22+, A2s+, KQo</span>），留空則視為隨機手牌。翻牌後單挑為精確計算，其餘為蒙地卡羅模擬。</p>`;
}

async function runCalc() {
  const players = calc.players.map((p) => ({
    cards: p.cards[0] >= 0 && p.cards[1] >= 0 ? p.cards.slice() : null,
    range: p.range.trim() || null,
  }));
  if (!players[0].cards) { toast('請先選玩家 1 的兩張手牌'); return; }
  const b = calc.board;
  const board = b[0] >= 0 && b[1] >= 0 && b[2] >= 0 ? b.filter((c, i) => c >= 0 && (i < 3 || (i === 3 && b[3] >= 0) || (i === 4 && b[3] >= 0))) : [];
  calc.busy = true; render();
  try {
    // compute equity for each player that has cards; players with ranges get computed via symmetrical runs
    const res = await engine('equity', { players, board });
    // players without specific cards: equity = 1 - sum(others) split (approx) when exactly one unknown
    const known = res.map((r) => r?.equity ?? null);
    const unknownIdx = known.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
    if (unknownIdx.length === 1 && res[0]) {
      const sum = known.reduce((s, v) => s + (v ?? 0), 0);
      res[unknownIdx[0]] = { equity: Math.max(0, 1 - sum), win: NaN, tie: NaN, approx: true };
    }
    calc.result = res;
  } catch (err) { toast('計算失敗：' + err.message); }
  calc.busy = false;
  render();
}

// ---------- outs table ----------
function oddsHTML() {
  let rows = '';
  for (let o = 1; o <= 21; o++) {
    const turn = o / 47, river = o / 46, both = 1 - ((47 - o) * (46 - o)) / (47 * 46);
    const hl = [4, 8, 9, 12, 15].includes(o);
    rows += `<tr style="${hl ? 'color:var(--ink);font-weight:700' : ''}"><td>${o}${hl ? ` <span class="hint">${{ 4: '卡順', 8: '兩頭順', 9: '同花聽', 12: '同花+卡順', 15: '同花+兩頭' }[o]}</span>` : ''}</td><td class="mono">${pct(turn, 1)}</td><td class="mono">${pct(river, 1)}</td><td class="mono">${pct(both, 1)}</td><td class="mono">${(1 / turn - 1).toFixed(1)}:1</td></tr>`;
  }
  return `<div class="panel"><div class="table-scroll"><table class="odds-table">
    <thead><tr><th>Outs</th><th>翻→轉</th><th>轉→河</th><th>翻→河</th><th>賠率</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint" style="margin:10px 0 0">速算：翻牌時 outs × 4 ≈ 到河牌機率；轉牌時 outs × 2 ≈ 下一張機率。「賠率」為下一張牌中的反向賠率（對比底池賠率決定是否跟注）。</p></div>`;
}

// ---------- pot odds ----------
function potOddsHTML() {
  const req = po.bet / (po.pot + 2 * po.bet);
  const mdf = po.pot / (po.pot + po.bet);
  const bluffBE = po.bet / (po.pot + po.bet);
  const bluffRatio = po.bet / (po.pot + 2 * po.bet);
  return `<div class="panel">
    <div class="row"><label>底池</label><div class="stepper"><button data-po="pot" data-d="-1">−</button><input class="val num" data-poin="pot" inputmode="decimal" value="${po.pot}" aria-label="底池"><button data-po="pot" data-d="1">+</button></div><span class="hint">下注前</span></div>
    <div class="row"><label>對手下注</label><div class="stepper"><button data-po="bet" data-d="-1">−</button><input class="val num" data-poin="bet" inputmode="decimal" value="${po.bet}" aria-label="下注"><button data-po="bet" data-d="1">+</button></div><span class="hint">${Math.round((po.bet / Math.max(0.01, po.pot)) * 100)}% 池</span></div>
    <div class="divider"></div>
    <div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="stat"><div class="k">跟注需要勝率</div><div class="v">${pct(req)}</div></div>
      <div class="stat"><div class="k">底池賠率</div><div class="v">${((po.pot + po.bet) / Math.max(0.01, po.bet)).toFixed(2)} : 1</div></div>
      <div class="stat"><div class="k">最低防守頻率 MDF</div><div class="v">${pct(mdf)}</div></div>
      <div class="stat"><div class="k">詐唬需成功率</div><div class="v">${pct(bluffBE)}</div></div>
    </div>
    <p class="hint" style="margin:12px 0 0">平衡下注範圍中詐唬比例約 ${pct(bluffRatio, 0)}。MDF：面對此尺寸至少要繼續 ${pct(mdf, 0)} 的範圍，否則對手任意詐唬都能獲利。</p></div>`;
}

// ---------- history ----------
function historyHTML() {
  if (!state.history.length) return `<div class="panel"><div class="empty-state"><b>還沒有紀錄</b>在牌桌按「新的一手」時，上一手會自動存到這裡，方便復盤。</div></div>`;
  const items = state.history.map((x, i) => {
    const d = new Date(x.ts);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `<div class="list-item"><div class="cards" style="display:flex;gap:3px">${x.hero.map((c) => miniCardHTML(c)).join('')}</div>
      <div class="grow"><div class="t">${x.board.length ? x.board.map(cardText).join(' ') : '翻前'}</div>
      <div class="d">${esc(POS_SHORT[x.heroPos] || x.heroPos)} · ${when}${x.rec ? ` · 建議 ${esc(x.rec.label)}${x.rec.eq != null ? `（勝率 ${pct(x.rec.eq, 0)}）` : ''}` : ''}</div></div>
      <button class="icon-btn" data-load="${i}" aria-label="載入這手牌">${ICON.chevron}</button></div>`;
  }).join('');
  return `<div class="list" style="margin-top:12px">${items}</div>
    <button class="btn block" style="margin-top:12px" data-x="clearhist">${ICON.trash}清除全部紀錄</button>`;
}

// ---------- events ----------
async function onClick(e) {
  const b = e.target.closest('[data-tab2],[data-x],[data-pc],[data-bc],[data-rm],[data-po],[data-load]');
  if (!b || !root.contains(b)) return;
  haptic();
  if (b.dataset.tab2) { tab = b.dataset.tab2; return render(); }
  const x = b.dataset.x;
  if (x === 'addp') { calc.players.push({ cards: [-1, -1], range: '' }); calc.result = null; return render(); }
  if (x === 'calc') return runCalc();
  if (x === 'clearboard') { calc.board = [-1, -1, -1, -1, -1]; calc.result = null; return render(); }
  if (x === 'clearhist') { state.history = []; emit('history'); return render(); }
  if (b.dataset.rm) { calc.players.splice(+b.dataset.rm, 1); calc.result = null; return render(); }
  if (b.dataset.pc) {
    const [i, j] = b.dataset.pc.split(':').map(Number);
    const cur = calc.players[i].cards[j];
    const u = used(); u.delete(cur);
    const c = await pickOne({ used: u, title: `玩家 ${i + 1} 的第 ${j + 1} 張` });
    if (c != null) { calc.players[i].cards[j] = c; calc.result = null; render(); }
    return;
  }
  if (b.dataset.bc) {
    const i = +b.dataset.bc;
    const u = used(); u.delete(calc.board[i]);
    const c = await pickOne({ used: u, title: ['翻牌 1', '翻牌 2', '翻牌 3', '轉牌', '河牌'][i] });
    if (c != null) { calc.board[i] = c; calc.result = null; render(); }
    return;
  }
  if (b.dataset.po) { po[b.dataset.po] = Math.max(0.5, +(po[b.dataset.po] + +b.dataset.d).toFixed(1)); return render(); }
  if (b.dataset.load) {
    const x2 = state.history[+b.dataset.load];
    const h = state.hand;
    h.hero = x2.hero.slice(); h.board = [0, 1, 2, 3, 4].map((k) => x2.board[k] ?? -1); h.heroPos = x2.heroPos;
    h.flop = null; h.log = {};
    emit('hand');
    document.querySelector('[data-tab="table"]')?.click();
    import('./table-view.js').then((m) => m.onCardsChanged());
  }
}
function onInput(e) {
  const t = e.target;
  if (t.dataset.range != null) { calc.players[+t.dataset.range].range = t.value; calc.result = null; }
  if (t.dataset.poin) { const v = parseFloat(t.value); if (v > 0) { po[t.dataset.poin] = v; const keep = t.dataset.poin; render(); const inp = root.querySelector(`[data-poin="${keep}"]`); inp?.focus(); inp?.setSelectionRange(inp.value.length, inp.value.length); } }
}
