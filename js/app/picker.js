// Card picker bottom sheet: 13x4 grid, auto-advances through slots.
import { state, emit, usedCards } from './state.js';
import { openSheet, closeSheet, haptic, miniCardHTML, esc } from './ui.js';
import { makeCard, RANK_LABELS, SUIT_SYMBOLS } from '../core/cards.js';

const ORDER = ['h0', 'h1', 'b0', 'b1', 'b2', 'b3', 'b4'];
const LABEL = { h0: '手牌 1', h1: '手牌 2', b0: '翻牌 1', b1: '翻牌 2', b2: '翻牌 3', b3: '轉牌', b4: '河牌' };
const SUIT_ROWS = [3, 2, 1, 0]; // ♠ ♥ ♦ ♣

function get(slot) { const h = state.hand; return slot[0] === 'h' ? h.hero[+slot[1]] : h.board[+slot[1]]; }
function set(slot, c) { const h = state.hand; if (slot[0] === 'h') h.hero[+slot[1]] = c; else h.board[+slot[1]] = c; }

/** Slots that make sense to fill next (board must be filled in order). */
function nextEmpty(from) {
  const i0 = ORDER.indexOf(from);
  for (let k = 1; k <= ORDER.length; k++) {
    const s = ORDER[(i0 + k) % ORDER.length];
    if (get(s) < 0 && allowed(s)) return s;
  }
  return null;
}
function allowed(slot) {
  const h = state.hand;
  if (slot === 'b3') return h.board[0] >= 0 && h.board[1] >= 0 && h.board[2] >= 0;
  if (slot === 'b4') return h.board[3] >= 0;
  return true;
}
/** When to auto-close: after hero pair, after flop trio, after turn, after river. */
function segmentDone(slot) {
  const h = state.hand;
  if (slot[0] === 'h') return h.hero[0] >= 0 && h.hero[1] >= 0;
  if (slot === 'b0' || slot === 'b1' || slot === 'b2') return h.board[0] >= 0 && h.board[1] >= 0 && h.board[2] >= 0;
  return true;
}

/** Generic single-card chooser. Resolves a card id, or null when dismissed. */
export function pickOne({ used = new Set(), title = '選一張牌' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let grid = '';
    for (const su of SUIT_ROWS) for (let r = 12; r >= 0; r--) {
      const c = makeCard(r, su);
      const isUsed = used.has(c);
      grid += `<button class="pcell suit-${'cdhs'[su]} ${isUsed ? 'used' : ''}" data-card="${c}" aria-label="${RANK_LABELS[r]}${SUIT_SYMBOLS[su]}">${RANK_LABELS[r] === '10' ? 'T' : RANK_LABELS[r]}<span class="s">${SUIT_SYMBOLS[su]}</span></button>`;
    }
    openSheet(`<div class="row" style="justify-content:space-between;margin-bottom:10px"><h3>${esc(title)}</h3><button class="chip" data-x="none">取消</button></div><div class="pgrid">${grid}</div>`, {
      onMount(sh) {
        sh.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          haptic();
          if (b.dataset.x === 'none') { closeSheet(); return; }
          if (b.dataset.card != null && !b.classList.contains('used')) { done = true; resolve(+b.dataset.card); closeSheet(); }
        });
      },
      onClose() { if (!done) resolve(null); },
    });
  });
}

export function openPicker(startSlot, onChanged) {
  let active = startSlot;
  // board order guard: jump to the first empty required slot
  if (!allowed(active)) active = ['b0', 'b1', 'b2', 'b3'].find((s) => get(s) < 0) || active;
  state.activeSlot = active;
  const draw = (sh) => {
    const used = usedCards();
    const cur = get(active);
    sh.querySelector('.picker-target').innerHTML = ORDER.map((s) => {
      const c = get(s);
      const dis = !allowed(s) && c < 0;
      return `<button class="${s === active ? 'on' : ''}" data-slot="${s}" ${dis ? 'disabled style="opacity:.35"' : ''} aria-label="${LABEL[s]}">${c >= 0 ? miniCardHTML(c) : esc(LABEL[s])}</button>`;
    }).join('');
    let grid = '';
    for (const su of SUIT_ROWS) {
      for (let r = 12; r >= 0; r--) {
        const c = makeCard(r, su);
        const isUsed = used.has(c) && c !== cur;
        grid += `<button class="pcell suit-${'cdhs'[su]} ${isUsed ? 'used' : ''} ${c === cur ? 'sel' : ''}" data-card="${c}" ${isUsed ? 'aria-disabled="true"' : ''} aria-label="${RANK_LABELS[r]}${SUIT_SYMBOLS[su]}">${RANK_LABELS[r] === '10' ? 'T' : RANK_LABELS[r]}<span class="s">${SUIT_SYMBOLS[su]}</span></button>`;
      }
    }
    sh.querySelector('.pgrid').innerHTML = grid;
    sh.querySelector('.ptitle').textContent = `選擇 ${LABEL[active]}`;
  };
  openSheet(`
    <div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 class="ptitle">選牌</h3>
      <div class="row" style="gap:6px"><button class="chip" data-x="clear">清除此格</button><button class="chip on" data-x="done">完成</button></div></div>
    <div class="picker-target"></div>
    <div class="pgrid" role="grid" aria-label="52 張牌"></div>
    <p class="hint" style="margin:12px 2px 0">點牌即填入並自動跳到下一格；已使用的牌會變暗。</p>`, {
    id: 'picker',
    onMount(sh) {
      draw(sh);
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        haptic();
        if (b.dataset.x === 'done') { closeSheet(); return; }
        if (b.dataset.x === 'clear') {
          set(active, -1);
          // clearing a flop card invalidates turn/river
          if (active[0] === 'b' && +active[1] <= 2) { set('b3', -1); set('b4', -1); }
          if (active === 'b3') set('b4', -1);
          onChanged && onChanged();
          draw(sh);
          return;
        }
        if (b.dataset.slot) { if (!b.disabled) { active = b.dataset.slot; state.activeSlot = active; draw(sh); } return; }
        if (b.dataset.card != null) {
          const c = +b.dataset.card;
          if (b.classList.contains('used')) return;
          set(active, c);
          onChanged && onChanged();
          if (segmentDone(active)) { closeSheet(); return; } // hero pair / flop / turn / river complete
          const nxt = nextEmpty(active);
          if (nxt) { active = nxt; state.activeSlot = active; }
          draw(sh);
        }
      });
    },
    onClose() { state.activeSlot = null; emit('hand'); onChanged && onChanged(); },
  });
}
