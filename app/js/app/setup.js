// Game setup sheet: table size, seat (position) picker, stack, open size, ante, opponent type.
import { state, emit } from './state.js';
import { openSheet, closeSheet, haptic, esc, fmtBB } from './ui.js';
import { positionsFor, POS_LABEL, POS_SHORT, VILLAIN_TYPES } from '../core/charts.js';

export function openSetup(onDone) {
  const s = state.settings, h = state.hand;
  const draw = (sh) => {
    const list = positionsFor(s.tableSize);
    if (!list.includes(h.heroPos)) h.heroPos = list.includes('BTN') ? 'BTN' : list[0];
    // seats around an ellipse; hero seat drawn at the bottom
    const n = list.length;
    const heroIdx = list.indexOf(h.heroPos);
    const seats = list.map((p, i) => {
      const k = (i - heroIdx + n) % n; // 0 = hero at bottom, clockwise order
      const ang = Math.PI / 2 + (k / n) * 2 * Math.PI;
      const x = 50 + 46 * Math.cos(ang), y = 50 + 42 * Math.sin(ang);
      return `<button class="seat ${p === h.heroPos ? 'on' : ''} ${p === 'BTN' ? 'dealer' : ''}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" data-pos="${p}" aria-label="${POS_LABEL[p]}">${POS_SHORT[p]}</button>`;
    }).join('');
    sh.querySelector('.content').innerHTML = `
      <div class="row"><label>桌型</label><div class="chips scroll">${[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<button class="chip ${s.tableSize === k ? 'on' : ''}" data-size="${k}">${k === 2 ? '單挑' : k === 6 ? '6 人' : k === 9 ? '9 人' : k + ' 人'}</button>`).join('')}</div></div>
      <div class="seat-table">${seats}<div class="seat-center">點選你的座位</div></div>
      <p class="hint" style="text-align:center;margin:10px 0 0">你：<b style="color:var(--brass-2)">${esc(POS_SHORT[h.heroPos])} ${esc(POS_LABEL[h.heroPos])}</b></p>
      <div class="divider"></div>
      <div class="row"><label>有效籌碼</label><div class="chips scroll">${[10, 15, 20, 30, 40, 60, 100, 150, 200].map((v) => `<button class="chip ${s.stack === v ? 'on' : ''}" data-stack="${v}">${v}<small>BB</small></button>`).join('')}</div></div>
      <div class="row"><label>開池尺寸</label><div class="chips scroll">${[2, 2.2, 2.5, 3, 3.5, 4, 5].map((v) => `<button class="chip ${s.openSize === v ? 'on' : ''}" data-open="${v}">${v}<small>BB</small></button>`).join('')}</div></div>
      <div class="row"><label>前注/人</label><div class="chips scroll">${[0, 0.1, 0.125, 0.2, 0.25].map((v) => `<button class="chip ${s.ante === v ? 'on' : ''}" data-ante="${v}">${v === 0 ? '無' : v + ' BB'}</button>`).join('')}</div></div>
      <div class="divider"></div>
      <div class="field-label" style="margin-bottom:8px">對手類型（影響範圍與剝削調整）</div>
      <div class="list">${Object.entries(VILLAIN_TYPES).map(([k, t]) => `<button class="list-item" data-vt="${k}" style="text-align:left;${s.villainType === k ? 'border-color:var(--brass);background:rgba(217,164,65,.08)' : ''}"><span class="grow"><span class="t">${esc(t.label)}</span><br><span class="d">${esc(t.desc)}</span></span></button>`).join('')}</div>`;
  };
  openSheet(`<h3>牌局設定</h3><div class="sub">桌型、你的位置、籌碼深度與對手類型</div><div class="content"></div>
    <button class="btn primary block" style="margin-top:16px" data-x="done">完成</button>`, {
    onMount(sh) {
      draw(sh);
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        haptic();
        if (b.dataset.x === 'done') { closeSheet(); return; }
        if (b.dataset.size) { s.tableSize = +b.dataset.size; }
        else if (b.dataset.pos) { h.heroPos = b.dataset.pos; h.pre.openerPos = ''; }
        else if (b.dataset.stack) s.stack = +b.dataset.stack;
        else if (b.dataset.open) { s.openSize = +b.dataset.open; h.pre.openSize = s.openSize; h.pre.heroOpen = s.openSize; }
        else if (b.dataset.ante != null) s.ante = +b.dataset.ante;
        else if (b.dataset.vt) s.villainType = b.dataset.vt;
        else return;
        emit('settings');
        draw(sh);
        onDone && onDone();
      });
    },
    onClose() { onDone && onDone(); },
  });
}
