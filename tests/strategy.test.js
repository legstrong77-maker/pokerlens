import { analyze } from '../app/js/core/strategy.js';
import { parseCards } from '../app/js/core/cards.js';
const show = (title, spot) => {
  const t0 = performance.now();
  const r = analyze({ tableSize: 6, stack: 100, villainType: 'unknown', ...spot, hero: parseCards(spot.hero), board: parseCards(spot.board || '') });
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`\n=== ${title} [${ms}ms] → ${r.action.label}  (${r.confidence})`);
  console.log('   mix:', r.mix.map(m => `${m.label} ${(m.freq*100).toFixed(0)}%${m.ev!=null?` ev=${m.ev.toFixed(2)}`:''}`).join(' | '));
  console.log('   eq:', (r.equity.value*100).toFixed(1)+'%', 'vsRand', (r.equity.vsRandom*100).toFixed(1)+'%', r.potOdds ? `req ${(r.potOdds.required*100).toFixed(1)}%` : '');
  for (const x of r.reasons) console.log('   -', x);
};
show('AKo BTN unopened', { hero: 'As Kd', heroPos: 'BTN', preflop: { scenario: 'unopened' } });
show('72o UTG unopened', { hero: '7s 2d', heroPos: 'UTG', preflop: { scenario: 'unopened' } });
show('A5s BB vs BTN open', { hero: 'Ah 5h', heroPos: 'BB', preflop: { scenario: 'vsOpen', openerPos: 'BTN', openSize: 2.5 } });
show('JTs BTN vs CO', { hero: 'Js Ts', heroPos: 'BTN', preflop: { scenario: 'vsOpen', openerPos: 'CO', openSize: 2.5 } });
show('QQ CO vs 3bet BTN', { hero: 'Qs Qd', heroPos: 'CO', preflop: { scenario: 'vs3bet', openerPos: 'BTN', heroOpen: 2.5, openSize: 7.5 } });
show('K9o SB 10bb', { hero: 'Kc 9d', heroPos: 'SB', stack: 10, preflop: { scenario: 'unopened' } });
// Postflop
show('TPTK BTN cbet dry', { hero: 'As Kd', heroPos: 'BTN', board: 'Kc 8h 3s', postflop: { pot: 5.5, effStack: 97.5, villains: 1, villainPos: 'BB', potType: 'srp', heroAggressor: true, heroIP: true, facing: 'none', villainChecked: true } });
show('Air BTN cbet dry', { hero: 'Qs Jd', heroPos: 'BTN', board: 'Kc 8h 3s', postflop: { pot: 5.5, effStack: 97.5, villains: 1, villainPos: 'BB', potType: 'srp', heroAggressor: true, heroIP: true, facing: 'none', villainChecked: true } });
show('NFD facing 2/3 bet', { hero: 'Ah 5h', heroPos: 'BB', board: 'Kh 9h 4c', postflop: { pot: 5.5, effStack: 97.5, villains: 1, villainPos: 'BTN', potType: 'srp', heroAggressor: false, heroIP: false, facing: 'bet', bet: 3.6 } });
show('Middle pair facing pot bet river', { hero: '9c 8c', heroPos: 'BB', board: 'Kh 9d 4s 2c Qd', postflop: { pot: 20, effStack: 80, villains: 1, villainPos: 'BTN', potType: 'srp', heroAggressor: false, heroIP: false, facing: 'bet', bet: 20, history: [{street:3, villain:'bet', size:0.33},{street:4, villain:'bet', size:0.66}] } });
show('Set on wet flop multiway', { hero: '7s 7d', heroPos: 'BTN', board: '7h 8h 9c', postflop: { pot: 10, effStack: 95, villains: 2, villainPos: 'CO', potType: 'srp', heroAggressor: false, heroIP: true, facing: 'bet', bet: 6 } });
show('Nut flush river vs station', { hero: 'Ah Th', heroPos: 'BTN', villainType: 'station', board: 'Kh 7h 2c 9s 4h', postflop: { pot: 30, effStack: 70, villains: 1, villainPos: 'BB', potType: 'srp', heroAggressor: true, heroIP: true, facing: 'none', villainChecked: true, history: [{street:3, villain:'call', size:0.33},{street:4, villain:'call', size:0.66}] } });
