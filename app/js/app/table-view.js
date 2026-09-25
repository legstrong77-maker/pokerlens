// Table / analysis screen.
import {
  state, emit, newHand, deriveSpot, boardCards, streetOf, STREET_ZH, autoFlopSetup, defaultLogFor,
  positionsBefore, positionsAfter, defaultOpener, default3Bettor, LOG_LABEL, heroIsIP, usedCards,
} from './state.js';
import { positionsFor, POS_LABEL, POS_SHORT, VILLAIN_TYPES } from '../core/charts.js';
import {
  $, esc, cardHTML, miniCardHTML, fmtBB, pct, ICON, toast, haptic, openSheet, closeSheet, ACTION_EN, ACTION_ZH,
  cardText,
} from './ui.js';
import { openPicker } from './picker.js';
import { engineLatest } from './engine-client.js';
import { className, NUM_CLASSES } from '../core/cards.js';
import { CAT_NAMES } from '../core/evaluator.js';

const posName = (p) => `${POS_SHORT[p] || p} ${POS_LABEL[p] || ''}`.trim();
const potTypeZh = { srp: '單次加注底池', '3bet': '3-bet 底池', '4bet': '4-bet 底池', limped: '跛入底池' };

let root = null;
export function mountTable(el) {
  root = el;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  render();
}

// ---------------------------------------------------------------- render
export function render() {
  if (!root) return;
  const s = state.settings, h = state.hand;
  const d = deriveSpot();
  const size = s.tableSize;
  const vt = VILLAIN_TYPES[s.villainType] || VILLAIN_TYPES.unknown;
  const street = d.street;
  const act = state.activeSlot;
  const slot = (kind, i, label) => {
    const c = kind === 'h' ? h.hero[i] : h.board[i];
    const id = `${kind}${i}`;
    const on = act === id ? 'active' : '';
    if (c >= 0) return `<button class="slot-btn" data-act="slot" data-slot="${id}" aria-label="更換 ${cardText(c)}">${cardHTML(c, on)}</button>`;
    return `<button class="slot ${on}" data-act="slot" data-slot="${id}" aria-label="選擇${label}"><span><span class="plus">+</span>${label}</span></button>`;
  };
  const pot = street === 'preflop' ? null : d.pot;
  const spr = street === 'preflop' ? null : d.effStack / Math.max(0.5, d.pot);

  root.innerHTML = `
    <button class="situation" data-act="setup" aria-label="牌局設定">
      <span class="tag pos">${esc(posName(h.heroPos))}</span>
      <span class="tag"><b>${size}</b> 人桌</span>
      <span class="tag"><b>${fmtBB(s.stack, false)}</b> BB</span>
      <span class="tag">對手 <b>${esc(vt.short)}</b></span>
      <span class="edit">設定 ›</span>
    </button>

    <div class="felt" aria-label="牌桌">
      <div class="felt-meta">
        <span>${STREET_ZH[street]}</span>
        ${pot != null ? `<span class="pot num">${fmtBB(pot, false)}<small>BB 底池</small></span><span>SPR ${spr.toFixed(1)}</span>` : `<span class="pot">PRE<small>FLOP</small></span><span>${s.ante ? `前注 ${s.ante}` : '無前注'}</span>`}
      </div>
      <div class="board">
        ${slot('b', 0, '翻牌')}${slot('b', 1, '翻牌')}${slot('b', 2, '翻牌')}${slot('b', 3, '轉牌')}${slot('b', 4, '河牌')}
      </div>
      <div class="street-labels"><span>FLOP</span><span>TURN</span><span>RIVER</span></div>
      <div class="hero-row">
        <div class="hero-cards">${slot('h', 0, '手牌')}${slot('h', 1, '手牌')}</div>
        <span class="hero-badge">你 · ${esc(POS_SHORT[h.heroPos])}</span>
      </div>
    </div>

    <div class="cta-row">
      <button class="btn" data-act="scan">${ICON.camera}<span>掃描牌面</span></button>
      <button class="btn" data-act="newhand">${ICON.reset}<span>新的一手</span></button>
    </div>

    ${street === 'preflop' ? preflopPanel(d) : postflopPanel(d)}

    <div id="decision">${decisionHTML(state.result, d)}</div>
  `;
}

function chip(label, on, attrs, small = '') {
  return `<button class="chip ${on ? 'on' : ''}" ${attrs}>${label}${small ? `<small>${small}</small>` : ''}</button>`;
}
function stepper(act, val, unit = '', step = 1, attrs = '') {
  return `<div class="stepper" ${attrs}>
    <button data-act="${act}" data-d="${-step}" aria-label="減少">−</button>
    <div class="val num">${esc(val)}${unit ? `<small> ${unit}</small>` : ''}</div>
    <button data-act="${act}" data-d="${step}" aria-label="增加">+</button></div>`;
}

function preflopPanel(d) {
  const s = state.settings, h = state.hand, pre = h.pre, size = s.tableSize;
  const before = positionsBefore(h.heroPos, size);
  const after = positionsAfter(h.heroPos, size);
  const sc = pre.scenario;
  const scen = [
    ['unopened', h.heroPos === 'BB' ? '大家棄牌' : '沒人入池', true],
    ['limped', '有人跛入', before.length > 0 || h.heroPos === 'BB'],
    ['vsOpen', '有人開池', before.length > 0],
    ['vs3bet', '我開池被 3-bet', after.length > 0],
    ['vs4bet', '我 3-bet 被 4-bet', true],
  ];
  let rows = '';
  if (sc === 'limped') {
    rows += `<div class="row"><label>跛入人數</label>${stepper('limpers', pre.limpers || 1, '人')}</div>`;
  } else if (sc === 'vsOpen') {
    const op = pre.openerPos && before.includes(pre.openerPos) ? pre.openerPos : defaultOpener(h, size);
    rows += `<div class="row"><label>開池位置</label><div class="chips scroll">${before.map((p) => chip(POS_SHORT[p], p === op, `data-act="opener" data-v="${p}"`)).join('')}</div></div>`;
    rows += `<div class="row"><label>開到</label><div class="chips scroll">${[2, 2.2, 2.5, 3, 3.5, 4, 5, 6].map((v) => chip(v, Math.abs((pre.openSize || 2.5) - v) < 0.01, `data-act="opensize" data-v="${v}"`, 'BB')).join('')}</div></div>`;
    rows += `<div class="row"><label>已跟注</label>${stepper('callers', pre.callers || 0, '人')}</div>`;
  } else if (sc === 'vs3bet') {
    const tb = pre.openerPos && after.includes(pre.openerPos) ? pre.openerPos : default3Bettor(h, size);
    rows += `<div class="row"><label>3-bet 者</label><div class="chips scroll">${after.map((p) => chip(POS_SHORT[p], p === tb, `data-act="opener" data-v="${p}"`)).join('')}</div></div>`;
    rows += `<div class="row"><label>我開到</label><div class="chips scroll">${[2, 2.2, 2.5, 3, 3.5, 4].map((v) => chip(v, Math.abs((pre.heroOpen || 2.5) - v) < 0.01, `data-act="heroopen" data-v="${v}"`, 'BB')).join('')}</div></div>`;
    const T = pre.threeBet || (pre.heroOpen || 2.5) * 3.5;
    rows += `<div class="row"><label>3-bet 到</label>${stepper('threebet', fmtBB(T, false), 'BB', 0.5)}</div>`;
  } else if (sc === 'vs4bet') {
    const v = pre.openerPos || default3Bettor(h, size);
    rows += `<div class="row"><label>4-bet 者</label><div class="chips scroll">${positionsFor(size).filter((p) => p !== h.heroPos).map((p) => chip(POS_SHORT[p], p === v, `data-act="opener" data-v="${p}"`)).join('')}</div></div>`;
    rows += `<div class="row"><label>我 3-bet</label>${stepper('threebet', fmtBB(pre.threeBet || 9, false), 'BB', 0.5)}</div>`;
    rows += `<div class="row"><label>4-bet 到</label>${stepper('fourbet', fmtBB(pre.fourBet || 22, false), 'BB', 1)}</div>`;
  }
  return `<div class="panel" aria-label="翻前情況">
    <div class="row" style="align-items:flex-start"><label style="padding-top:8px">翻前</label>
      <div class="chips">${scen.filter((x) => x[2]).map(([k, lbl]) => chip(lbl, sc === k, `data-act="scenario" data-v="${k}"`)).join('')}</div></div>
    ${rows}
  </div>`;
}

function postflopPanel(d) {
  const s = state.settings, h = state.hand;
  if (d.allIn) {
    return `<div class="panel"><div class="hint">翻前已全下：只需看勝率，不再有翻後決策。</div></div>`;
  }
  const fs = d.flopSetup;
  const n = d.board.length;
  const cur = d.cur;
  const setup = `<button class="situation" data-act="flopsetup" style="margin-top:14px">
      <span class="tag">${esc(potTypeZh[fs.potType] || '')}</span>
      <span class="tag">${fs.heroAggressor ? '你是翻前進攻者' : '對手是翻前進攻者'}</span>
      <span class="tag">對手 <b>${esc(POS_SHORT[fs.villainPos] || fs.villainPos)}</b>${fs.villains > 1 ? ` +${fs.villains - 1}` : ''}</span>
      <span class="tag ${d.heroIP ? 'pos' : ''}">${d.heroIP ? '有位置' : '沒位置'}</span>
      <span class="edit">修改 ›</span></button>`;
  let logs = '';
  for (const k of [3, 4]) {
    if (k >= n) break;
    const lg = h.log[k] || defaultLogFor(k);
    logs += `<button class="list-item" data-act="log" data-street="${k}" style="width:100%;text-align:left;margin-top:8px">
      <span class="pill">${STREET_ZH[streetOf(k)]}</span>
      <span class="grow"><span class="t" style="font-size:13px">${esc(LOG_LABEL[lg.kind])}${lg.kind !== 'xx' ? ` · ${fmtBB(lg.amount)}` : ''}</span></span>
      <span class="hint">修改 ›</span></button>`;
  }
  const facingOpts = [
    ['none', d.heroIP ? '對手過牌' : '我先行動'],
    ['bet', '對手下注'],
    ['raise', '對手加注'],
  ];
  let rows = '';
  const pot = d.pot;
  if (cur.facing === 'bet') {
    const fr = [[0.25, '1/4'], [0.33, '1/3'], [0.5, '1/2'], [0.66, '2/3'], [0.75, '3/4'], [1, '滿池'], [1.5, '1.5x']];
    rows += `<div class="row"><label>下注額</label><div class="chips scroll">${fr.map(([f, l]) => chip(l, Math.abs(cur.bet - pot * f) < 0.05, `data-act="betfrac" data-v="${f}"`, fmtBB(pot * f, false))).join('')}</div></div>`;
    rows += `<div class="row"><label></label>${stepper('bet', fmtBB(cur.bet || 0, false), 'BB', 0.5)}<span class="hint">底池賠率 ${cur.bet > 0 ? (((pot + cur.bet) / cur.bet)).toFixed(1) + ' : 1' : '—'}</span></div>`;
  } else if (cur.facing === 'raise') {
    rows += `<div class="row"><label>我下注</label>${stepper('herobet', fmtBB(cur.heroBet || 0, false), 'BB', 0.5)}</div>`;
    const hb = cur.heroBet || pot * 0.5;
    rows += `<div class="row"><label>加注到</label><div class="chips scroll">${[2.5, 3, 4, 5].map((m) => chip(`${m}x`, Math.abs(cur.bet - hb * m) < 0.05, `data-act="raisemult" data-v="${m}"`, fmtBB(hb * m, false))).join('')}</div></div>`;
    rows += `<div class="row"><label></label>${stepper('bet', fmtBB(cur.bet || 0, false), 'BB', 1)}</div>`;
  }
  return `${setup}${logs}
    <div class="panel" aria-label="${STREET_ZH[d.street]}行動">
      <div class="row"><label>${STREET_ZH[d.street]}</label><div class="seg" role="tablist">${facingOpts.map(([k, l]) => `<button class="${cur.facing === k ? 'on' : ''}" data-act="facing" data-v="${k}">${l}</button>`).join('')}</div></div>
      ${rows}
      <div class="row"><label>有效籌碼</label><span class="num" style="font-weight:700">${fmtBB(d.effStack)}</span><span class="hint">· ${fs.villains > 1 ? `${fs.villains} 位對手` : '單挑'}</span></div>
    </div>`;
}

// ---------------------------------------------------------------- decision
const KEYCLASS = { fold: 'k-fold', check: 'k-check', call: 'k-call', bet: 'k-bet', raise: 'k-raise', allin: 'k-allin' };
const CONF_ZH = { clear: '明確', lean: '傾向', close: '接近・可混合' };

function decisionHTML(r, d) {
  const h = state.hand;
  if (!d.ready) {
    return `<div class="decision"><div class="empty-state"><b>先選你的兩張手牌</b>點上方的手牌格子手動選牌，或用相機掃描。<br>AI 會即時算出勝率並建議下注、跟注或棄牌。</div>
      <div class="cta-row" style="padding:0 16px 16px"><button class="btn primary" data-act="scan">${ICON.camera}掃描</button><button class="btn" data-act="slot" data-slot="h0">手動選牌</button></div></div>`;
  }
  if (d.allIn) return `<div class="decision"><div class="empty-state"><b>翻前全下</b>到「工具 → 勝率計算」查看對抗對手手牌的勝率。</div></div>`;
  if (!r) return `<div class="decision"><div class="head"><div class="eyebrow">AI 分析中</div><div class="busy"></div><div class="act-line"><span class="act-word" style="color:var(--ink-3)">…</span></div></div></div>`;
  if (r.error) return `<div class="decision"><div class="empty-state"><b>無法分析</b>${esc(r.error)}</div></div>`;
  const key = r.action.key;
  const mix = r.mix || [];
  const mixbar = mix.map((m) => `<i class="k-c-${m.key}" style="width:${(m.freq * 100).toFixed(1)}%"></i>`).join('');
  const legend = mix.map((m) => `<span><i class="k-c-${m.key}"></i>${esc(shortLabel(m))} ${pct(m.freq, 0)}</span>`).join('');
  const eq = r.equity?.value ?? 0;
  const need = r.potOdds?.required;
  const C = 2 * Math.PI * 52;
  const needMark = need != null ? (() => {
    const a = need * 2 * Math.PI;
    const x1 = 62 + 44 * Math.cos(a), y1 = 62 + 44 * Math.sin(a), x2 = 62 + 60 * Math.cos(a), y2 = 62 + 60 * Math.sin(a);
    return `<line class="need" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  })() : '';
  const sizeLine = sizeText(r);
  const stats = [];
  stats.push(stat('底池', fmtBB(r.pot, false), 'BB'));
  if (r.potOdds) {
    stats.push(stat('需跟注', fmtBB(r.potOdds.toCall, false), 'BB'));
    stats.push(stat('需要勝率', pct(r.potOdds.required), '', eq >= r.potOdds.required ? 'good' : 'bad'));
  } else stats.push(stat(r.street === 'preflop' ? '對隨機' : '對隨機手牌', pct(r.equity?.vsRandom ?? 0)));
  if (r.street === 'preflop') stats.push(stat('起手牌排名', `前 ${Math.max(1, Math.round((r.handPercentile ?? 0.5) * 100))}%`));
  else stats.push(stat('SPR', (r.spr ?? 0).toFixed(1)));
  if (!r.potOdds && r.street !== 'preflop') stats.push(stat('有效籌碼', fmtBB(r.effStack, false), 'BB'));

  let blocks = '';
  blocks += `<div class="block"><h4>為什麼這樣打</h4><ul class="reasons">${(r.reasons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${(r.warnings || []).map((w) => `<p class="hint" style="margin:8px 0 0">⚠ ${esc(w)}</p>`).join('')}</div>`;
  if (r.street !== 'preflop' && r.hand) {
    const hd = r.hand;
    const pills = [`<span class="pill hl">${esc(hd.label)}</span>`];
    if (hd.hs != null) pills.push(`<span class="pill">牌力 前 ${Math.max(1, Math.round((1 - hd.hs) * 100))}%</span>`);
    for (const dl of hd.drawLabels || []) pills.push(`<span class="pill">${esc(dl)}</span>`);
    if (hd.outsCount && r.street !== 'river') pills.push(`<span class="pill">${hd.outsCount} outs · 下張 ${pct(hd.pNext, 0)}${r.street === 'flop' ? ` · 到河 ${pct(hd.pRiver, 0)}` : ''}</span>`);
    const outs = (r.outs || []).map((o) => `<div class="hint" style="margin-top:8px">${esc(o.type)}（${o.count}）：${o.cards.map(esc).join(' ')}</div>`).join('');
    blocks += `<div class="block"><h4>你的牌</h4><div class="pillrow">${pills.join('')}</div>${outs}</div>`;
  }
  if (r.villain) {
    const comp = r.villain.composition;
    const compHTML = comp ? `<div class="compbar">${comp.map((x, i) => `<i class="c${i}" style="width:${(x * 100).toFixed(1)}%"></i>`).join('')}</div>
      <div class="comp-legend">${['怪物', '強牌', '中等', '聽牌', '弱/空氣'].map((n, i) => `<span><i class="c${i}"></i>${n} ${pct(comp[i], 0)}</span>`).join('')}</div>` : '';
    blocks += `<div class="block"><h4>對手範圍估計 <span class="hint" style="text-transform:none;letter-spacing:0">${r.villain.width != null ? `約 ${pct(r.villain.width, 0)} 起手牌` : r.villain.combos != null ? `約 ${Math.round(r.villain.combos)} 組合` : ''}</span></h4>
      <p class="hint" style="margin:0 0 8px">${esc(r.villain.desc || '')}</p>
      ${compHTML}
      <div style="margin-top:10px">${rangeGridHTML(r.villain.grid, r.handClass)}</div></div>`;
  }
  if (r.allActions?.length || r.mix?.some((m) => m.ev != null)) {
    const rows = (r.allActions || r.mix).slice().sort((a, b) => b.ev - a.ev).map((a) => `<tr class="${a.label === r.action.label ? 'best' : ''}"><td>${esc(a.label)}${a.fold != null ? `<span class="hint"> · 棄牌率 ${pct(a.fold, 0)}</span>` : ''}</td><td class="${a.ev >= 0 ? 'pos' : 'neg'}">${a.ev >= 0 ? '+' : ''}${fmtBB(a.ev)}</td></tr>`).join('');
    blocks += `<details class="block more"><summary><h4>各行動期望值 (EV) <span class="hint">展開 ›</span></h4></summary><table class="ev-table">${rows}</table>
      <p class="hint" style="margin:8px 0 0">EV 以目前底池為基準估算（含棄牌率、被跟注勝率與勝率實現）。</p></details>`;
  }
  if (r.street === 'flop' || r.street === 'turn') {
    const cats = r.equity?.heroCats || [];
    const rowsD = cats.map((p, i) => ({ p, i })).filter((x) => x.p >= 0.005).sort((a, b) => b.i - a.i)
      .map((x) => `<div class="d"><span>${CAT_NAMES[x.i]}</span><span class="bar"><i style="width:${Math.min(100, x.p * 100).toFixed(1)}%"></i></span><span>${pct(x.p, 1)}</span></div>`).join('');
    blocks += `<details class="block more"><summary><h4>河牌時你的成牌機率 <span class="hint">展開 ›</span></h4></summary><div class="distrib">${rowsD}</div></details>`;
  }
  const next = nextStepHTML(d, r);
  return `<div class="decision ${KEYCLASS[key] || ''}">
    <div class="head">
      <div class="eyebrow"><span>AI 建議 · ${STREET_ZH[r.street]}</span><span class="conf ${r.confidence}">${CONF_ZH[r.confidence] || ''}</span></div>
      ${state.busy ? '<div class="busy" aria-label="計算中"></div>' : ''}
      <div class="act-line"><span class="act-word">${ACTION_ZH[key]}</span><span class="act-en">${ACTION_EN[key]}</span></div>
      ${sizeLine ? `<div class="act-size">${sizeLine}</div>` : ''}
      <div class="mixbar" aria-hidden="true">${mixbar}</div>
      <div class="mixlegend">${legend}</div>
    </div>
    <div class="eq-wrap">
      <div class="ring" role="img" aria-label="勝率 ${pct(eq)}">
        <svg viewBox="0 0 124 124"><circle class="track" cx="62" cy="62" r="52"/><circle class="val" cx="62" cy="62" r="52" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - eq)).toFixed(1)}"/>${needMark}</svg>
        <div class="center"><div class="big num">${(eq * 100).toFixed(1)}<small>%</small></div><div class="lbl">${r.street === 'preflop' && !r.equity?.vsRange ? '對隨機' : '勝率'}</div></div>
      </div>
      <div class="stats">${stats.join('')}</div>
    </div>
    ${blocks}
    ${next}
  </div>`;
}

function shortLabel(m) {
  const z = ACTION_ZH[m.key];
  if (m.sizeBB && (m.key === 'bet' || m.key === 'raise')) return `${z} ${fmtBB(m.sizeBB, false)}`;
  return z;
}
function sizeText(r) {
  const a = r.action;
  if (a.key === 'fold' || a.key === 'check') return '';
  const parts = a.label.replace(/^(開池加注到|3-bet 到|4-bet 到|加注孤立到|加注到|下注|跟注|全下|補盲跟入|跟入)\s*/, '');
  const pre = { raise: a.label.startsWith('3-bet') ? '3-bet 到' : a.label.startsWith('4-bet') ? '4-bet 到' : a.label.startsWith('開池') ? '開池到' : '到', bet: '', call: '', allin: '' }[a.key] || '';
  let sub = '';
  if (state.settings.bbValue > 0 && a.sizeBB) sub = `≈ ${state.settings.currency}${(a.sizeBB * state.settings.bbValue).toFixed(0)}`;
  return `${pre} ${esc(parts)}${sub ? `<span class="sub">${sub}</span>` : ''}`.trim();
}
function stat(k, v, unit = '', cls = '') {
  return `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
}

export function rangeGridHTML(grid, heroClass = -1, colorFn) {
  if (!grid) return '';
  const R = 'AKQJT98765432';
  let cells = '';
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const c = i * 13 + j;
    const w = grid[c] || 0;
    const name = i === j ? R[i] + R[j] : i < j ? R[i] + R[j] + 's' : R[j] + R[i] + 'o';
    const bg = colorFn ? colorFn(c, w) : w > 0.001 ? `rgba(226, 71, 125, ${(0.15 + 0.85 * w).toFixed(2)})` : '';
    cells += `<div class="cell ${c === heroClass ? 'hero' : ''}" style="${bg ? `background:${bg};color:${w > 0.45 ? '#fff' : ''}` : ''}"><span>${name}</span></div>`;
  }
  return `<div class="rgrid">${cells}</div>`;
}

function nextStepHTML(d, r) {
  const n = d.board.length;
  if (r.action.key === 'fold') return `<div class="block"><button class="btn block" data-act="newhand">${ICON.reset}下一手</button></div>`;
  if (n === 0) return `<div class="block"><button class="btn block" data-act="slot" data-slot="b0">發翻牌 →</button></div>`;
  if (n === 3) return `<div class="block"><button class="btn block" data-act="slot" data-slot="b3">發轉牌 →</button></div>`;
  if (n === 4) return `<div class="block"><button class="btn block" data-act="slot" data-slot="b4">發河牌 →</button></div>`;
  return `<div class="block"><button class="btn block" data-act="newhand">${ICON.reset}下一手</button></div>`;
}

// ---------------------------------------------------------------- analysis
let pendingTimer = 0;
export function scheduleAnalysis(immediate = false) {
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(runAnalysis, immediate ? 0 : 90);
}
async function runAnalysis() {
  const d = deriveSpot();
  if (!d.ready || !d.spot) { state.result = null; renderDecisionOnly(d); return; }
  state.busy = true;
  renderDecisionOnly(d);
  try {
    const res = await engineLatest('main', 'analyze', d.spot);
    if (!res) return;
    state.result = res;
    const h = state.hand;
    h.recs[res.street] = { key: res.action.key, sizeBB: res.action.sizeBB };
  } catch (err) {
    state.result = { error: err.message };
  } finally {
    state.busy = false;
  }
  renderDecisionOnly(deriveSpot());
}
function renderDecisionOnly(d) {
  const el = root && root.querySelector('#decision');
  if (el) el.innerHTML = decisionHTML(state.result, d);
}

// ---------------------------------------------------------------- events
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || !root.contains(el)) return;
  const act = el.dataset.act, v = el.dataset.v;
  const s = state.settings, h = state.hand;
  haptic();
  switch (act) {
    case 'slot': return openPicker(el.dataset.slot, onCardsChanged);
    case 'setup': return import('./setup.js').then((m) => m.openSetup(onSettingsChanged));
    case 'scan': return import('./scanner.js').then((m) => m.openScanner(onCardsChanged));
    case 'newhand': return newHandAction();
    case 'scenario': h.pre.scenario = v; if (v === 'vsOpen' || v === 'vs3bet' || v === 'vs4bet') h.pre.openerPos = ''; break;
    case 'limpers': h.pre.limpers = clamp((h.pre.limpers || 1) + +el.dataset.d, 1, 6); break;
    case 'callers': h.pre.callers = clamp((h.pre.callers || 0) + +el.dataset.d, 0, 5); break;
    case 'opener': h.pre.openerPos = v; break;
    case 'opensize': h.pre.openSize = +v; break;
    case 'heroopen': h.pre.heroOpen = +v; h.pre.threeBet = 0; break;
    case 'threebet': h.pre.threeBet = clamp(round1((h.pre.threeBet || (h.pre.scenario === 'vs4bet' ? 9 : (h.pre.heroOpen || 2.5) * 3.5)) + +el.dataset.d), 3, 200); break;
    case 'fourbet': h.pre.fourBet = clamp(round1((h.pre.fourBet || 22) + +el.dataset.d), 6, 300); break;
    case 'facing': {
      const d = deriveSpot();
      h.cur = { street: d.street, facing: v, bet: 0, heroBet: 0 };
      if (v === 'bet') h.cur.bet = round1(d.pot * 0.5);
      if (v === 'raise') { h.cur.heroBet = round1(d.pot * 0.5); h.cur.bet = round1(h.cur.heroBet * 3); }
      break;
    }
    case 'betfrac': { const d = deriveSpot(); h.cur.bet = round1(d.pot * +v); break; }
    case 'bet': h.cur.bet = Math.max(0.5, round1((h.cur.bet || 0) + +el.dataset.d)); break;
    case 'herobet': h.cur.heroBet = Math.max(0.5, round1((h.cur.heroBet || 0) + +el.dataset.d)); if (h.cur.bet < h.cur.heroBet * 2) h.cur.bet = round1(h.cur.heroBet * 2.5); break;
    case 'raisemult': h.cur.bet = round1((h.cur.heroBet || 1) * +v); break;
    case 'flopsetup': return openFlopSetup();
    case 'log': return openLogEditor(+el.dataset.street);
    default: return;
  }
  emit('hand');
  render();
  scheduleAnalysis();
}
function onChange() {}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round1 = (x) => Math.round(x * 10) / 10;

export function onCardsChanged() {
  const h = state.hand;
  const n = boardCards(h).length;
  if (n === 0) { h.flop = null; h.log = {}; }
  if (n >= 3 && !h.flop) h.flop = autoFlopSetup();
  for (const k of [3, 4]) {
    if (n > k && !h.log[k]) h.log[k] = defaultLogFor(k);
    if (n <= k) delete h.log[k];
  }
  const street = streetOf(n);
  if (h.cur.street !== street) h.cur = { street, facing: 'none', bet: 0, heroBet: 0 };
  state.result = null;
  emit('hand');
  render();
  scheduleAnalysis(true);
}
function onSettingsChanged() {
  const h = state.hand;
  if (h.flop) h.flop = { ...h.flop, heroIP: undefined };
  state.result = null;
  emit('settings');
  render();
  scheduleAnalysis(true);
}

function newHandAction() {
  const h = state.hand;
  if (h.hero[0] >= 0 && h.hero[1] >= 0) {
    state.history.unshift({
      ts: Date.now(), hero: h.hero.slice(), board: h.board.filter((c) => c >= 0), heroPos: h.heroPos,
      rec: state.result && !state.result.error ? { label: state.result.action.label, key: state.result.action.key, street: state.result.street, eq: state.result.equity?.value } : null,
    });
    state.history = state.history.slice(0, 60);
  }
  // rotate hero position clockwise for the next hand (live-game convenience)
  const list = positionsFor(state.settings.tableSize);
  const i = list.indexOf(h.heroPos);
  const nextPos = i >= 0 ? list[(i - 1 + list.length) % list.length] : h.heroPos;
  state.hand = newHand(state.settings, { heroPos: nextPos });
  state.result = null;
  state.activeSlot = null;
  emit('hand');
  render();
  toast(`新的一手 · 你的位置 ${POS_SHORT[nextPos]}（可在設定修改）`);
}

// ---------------------------------------------------------------- sheets
function openFlopSetup() {
  const s = state.settings, h = state.hand;
  const fs = { ...(h.flop || autoFlopSetup()) };
  const list = positionsFor(s.tableSize).filter((p) => p !== h.heroPos);
  const draw = (sh) => {
    const ip = fs.heroIP ?? heroIsIP(h.heroPos, fs.villainPos, s.tableSize);
    sh.querySelector('.content').innerHTML = `
      <div class="row"><label>底池類型</label><div class="seg">${Object.entries(potTypeZh).map(([k, l]) => `<button class="${fs.potType === k ? 'on' : ''}" data-f="potType" data-v="${k}">${l.replace('底池', '')}</button>`).join('')}</div></div>
      <div class="row"><label>翻前加注</label><div class="seg"><button class="${fs.heroAggressor ? 'on' : ''}" data-f="heroAggressor" data-v="1">我</button><button class="${!fs.heroAggressor ? 'on' : ''}" data-f="heroAggressor" data-v="0">對手</button></div></div>
      <div class="row"><label>主要對手</label><div class="chips scroll">${list.map((p) => chip(POS_SHORT[p], fs.villainPos === p, `data-f="villainPos" data-v="${p}"`)).join('')}</div></div>
      <div class="row"><label>對手人數</label>${stepper('', fs.villains || 1, '人', 1, 'data-f="villains"')}</div>
      <div class="row"><label>翻牌底池</label>${stepper('', fmtBB(fs.pot, false), 'BB', 0.5, 'data-f="pot"')}</div>
      <div class="row"><label>位置</label><div class="seg"><button class="${ip ? 'on' : ''}" data-f="heroIP" data-v="1">我有位置</button><button class="${!ip ? 'on' : ''}" data-f="heroIP" data-v="0">我沒位置</button></div></div>
      <p class="hint" style="margin-top:12px">預設值由翻前情況推算：${esc(autoFlopSetup().desc || '')}</p>`;
  };
  openSheet(`<h3>翻後設定</h3><div class="sub">底池、對手與位置（影響對手範圍與建議）</div><div class="content"></div>
    <div class="btn-row" style="margin-top:16px"><button class="btn" data-x="auto">重設為推算值</button><button class="btn primary" data-x="done">完成</button></div>`, {
    onMount(sh) {
      draw(sh);
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        haptic();
        if (b.dataset.x === 'done') { h.flop = fs; closeSheet(); onCardsChangedKeep(); return; }
        if (b.dataset.x === 'auto') { Object.assign(fs, autoFlopSetup()); delete fs.heroIP; draw(sh); return; }
        const holder = b.closest('[data-f]');
        const f = b.dataset.f || holder?.dataset.f;
        if (!f) return;
        if (b.dataset.d) {
          const dlt = +b.dataset.d;
          if (f === 'villains') fs.villains = clamp((fs.villains || 1) + Math.sign(dlt), 1, 5);
          if (f === 'pot') fs.pot = Math.max(1, round1(fs.pot + dlt));
        } else if (f === 'heroAggressor' || f === 'heroIP') fs[f] = b.dataset.v === '1';
        else fs[f] = b.dataset.v;
        if (f === 'villainPos') delete fs.heroIP;
        draw(sh);
      });
    },
  });
}
function onCardsChangedKeep() { state.result = null; emit('hand'); render(); scheduleAnalysis(true); }

function openLogEditor(n) {
  const h = state.hand;
  const lg = { ...(h.log[n] || defaultLogFor(n)) };
  const d0 = deriveSpot();
  const draw = (sh) => {
    sh.querySelector('.content').innerHTML = `
      <div class="list">${Object.entries(LOG_LABEL).map(([k, l]) => `<button class="list-item" data-k="${k}" style="text-align:left;${lg.kind === k ? 'border-color:var(--brass)' : ''}"><span class="grow"><span class="t">${l}</span></span>${lg.kind === k ? ICON.check : ''}</button>`).join('')}</div>
      ${lg.kind !== 'xx' ? `<div class="row" style="margin-top:14px"><label>${lg.kind === 'hbr' || lg.kind === 'vbr' ? '加注到' : '下注額'}</label>${stepper('', fmtBB(lg.amount || 0, false), 'BB', 0.5, 'data-f="amount"')}</div>` : ''}`;
  };
  openSheet(`<h3>${STREET_ZH[streetOf(n)]}怎麼結束？</h3><div class="sub">用來更新底池並推測對手範圍</div><div class="content"></div>
    <button class="btn primary block" style="margin-top:16px" data-x="done">完成</button>`, {
    onMount(sh) {
      draw(sh);
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        haptic();
        if (b.dataset.x === 'done') { h.log[n] = lg; closeSheet(); onCardsChangedKeep(); return; }
        if (b.dataset.k) { lg.kind = b.dataset.k; if (lg.kind !== 'xx' && !lg.amount) lg.amount = round1((d0.pot || 6) * 0.5); draw(sh); return; }
        if (b.dataset.d) { lg.amount = Math.max(0.5, round1((lg.amount || 0) + +b.dataset.d)); draw(sh); }
      });
    },
  });
}
