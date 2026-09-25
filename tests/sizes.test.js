import { analyze } from '../app/js/core/strategy.js';
import { parseCards } from '../app/js/core/cards.js';
const run = (title, hero, board, post, vt='unknown') => {
  const r = analyze({ tableSize: 6, stack: 100, villainType: vt, heroPos: 'BTN', hero: parseCards(hero), board: parseCards(board), postflop: post });
  console.log(`\n${title}: → ${r.action.label}`);
  for (const a of r.allActions) console.log(`   ${a.label.padEnd(24)} ev=${a.ev.toFixed(2)}  fold=${a.fold!=null?(a.fold*100).toFixed(0)+'%':'-'} eqC=${a.eqC!=null?(a.eqC*100).toFixed(0)+'%':'-'}`);
};
const base = { pot: 5.5, effStack: 97.5, villains: 1, villainPos: 'BB', potType: 'srp', heroAggressor: true, heroIP: true, facing: 'none', villainChecked: true };
run('TPTK K83r', 'As Kd', 'Kc 8h 3s', base);
run('Air QJ K83r', 'Qs Jd', 'Kc 8h 3s', base);
run('Overpair QQ on 9-7-5 two-tone', 'Qs Qd', '9h 7h 5c', base);
run('Middle pair 88 on KT8? no - 97 on K97', '9s 8s', 'Kc 9h 4d', base);
run('Turn TPTK K83-2', 'As Kd', 'Kc 8h 3s 2d', { ...base, pot: 9, effStack: 95.3, history: [{street:3, villain:'call', size:0.33}] });
