// PokerLens bootstrap: tabs, theme classes, service worker, first-run notice.
import { state, emit, save } from './app/state.js';
import { mountTable, render as renderTable, scheduleAnalysis, onCardsChanged } from './app/table-view.js';
import { $, $$, ICON, haptic, setHaptics, openSheet, closeSheet, toast } from './app/ui.js';

const views = {
  table: { el: () => $('#view-table'), mounted: false, mount: (el) => mountTable(el) },
  ranges: { el: () => $('#view-ranges'), mounted: false, mount: (el) => import('./app/ranges-view.js').then((m) => m.mountRanges(el)) },
  tools: { el: () => $('#view-tools'), mounted: false, mount: (el) => import('./app/tools-view.js').then((m) => m.mountTools(el)) },
  settings: { el: () => $('#view-settings'), mounted: false, mount: (el) => import('./app/settings-view.js').then((m) => m.mountSettings(el, applySettings)) },
};

function applySettings() {
  document.body.classList.toggle('two-color', !state.settings.fourColor);
  setHaptics(state.settings.haptics);
}

function show(tab) {
  if (tab === 'live') {
    import('./app/analyst.js').then((m) => m.openAnalyst());
    return;
  }
  state.tab = tab;
  for (const [k, v] of Object.entries(views)) {
    const el = v.el();
    el.hidden = k !== tab;
    if (k === tab && !v.mounted) { v.mounted = true; v.mount(el); }
  }
  $$('.tabbar .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo({ top: 0 });
  if (tab === 'table') renderTable();
}

function buildChrome() {
  $('#topbar-actions').innerHTML = `
    <button class="icon-btn" data-go="settings" aria-label="設定">${ICON.gear}</button>`;
  $('#tabbar-inner').innerHTML = `
    <button class="tab on" data-tab="table">${ICON.table}<span>牌桌</span></button>
    <button class="tab" data-tab="ranges">${ICON.grid}<span>範圍</span></button>
    <button class="tab fab" data-tab="live" aria-label="AI 即時分析"><span class="disc">${ICON.spark}</span><span>即時分析</span></button>
    <button class="tab" data-tab="tools">${ICON.tools}<span>工具</span></button>
    <button class="tab" data-tab="settings">${ICON.gear}<span>設定</span></button>`;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-go]');
    if (!t) return;
    haptic();
    show(t.dataset.tab || t.dataset.go);
  });
}

function intro() {
  if (state.settings.seenIntro) return;
  openSheet(`
    <h3>歡迎使用 PokerLens 牌眼</h3>
    <div class="sub">德州撲克 AI 決策助手 · 第一視角勝率分析</div>
    <ul class="reasons" style="margin:6px 0 14px">
      <li><b>掃描或點選</b>你的手牌與公牌，AI 立即算出勝率、底池賠率與 EV。</li>
      <li>依位置、籌碼深度與對手類型，建議<b>棄牌 / 過牌 / 跟注 / 下注尺寸</b>，並說明原因。</li>
      <li>內建翻前範圍表、推擠/棄牌（Nash）與勝率計算器。</li>
    </ul>
    <p class="disclaimer">公平競技提醒：多數娛樂場與線上平台禁止在牌局進行中使用即時輔助工具（RTA）。請用於練習、復盤、學習或經所有玩家同意的私人牌局。建議僅供參考，不保證獲利。</p>
    <button class="btn primary block" data-x="ok" style="margin-top:14px">開始使用</button>`, {
    onMount(sh) { sh.querySelector('[data-x="ok"]').addEventListener('click', () => { state.settings.seenIntro = true; save(); closeSheet(); }); },
    onClose() { state.settings.seenIntro = true; save(); },
  });
}

function registerSW() {
  const inArtifact = /claude\.ai|claudeusercontent|anthropic/.test(location.hostname) || window.self !== window.top;
  if (!('serviceWorker' in navigator) || inArtifact) return;
  const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (dev) { // never serve stale files while developing
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  if (location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

buildChrome();
applySettings();
show('table');
scheduleAnalysis(true);
intro();
registerSW();
window.addEventListener('pagehide', save);
