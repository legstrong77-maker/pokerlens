import { newTrack, act, state, trackerSpot, nextStreet, foldToHero, undo, options, describeTrack } from '../app/js/app/tracker.js';
let bad = 0;
const eq = (title, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${title}: ${JSON.stringify(got)}${ok ? '' : ' want ' + JSON.stringify(want)}`);
};
// 1) 6-max: UTG fold, HJ fold, CO opens 2.5, hero BTN to act
let tr = newTrack({ size: 6, heroPos: 'BTN', stack: 100 });
act(tr, 'fold'); act(tr, 'fold'); act(tr, 'raise', 2.5);
let sp = trackerSpot(tr);
eq('vsOpen scenario', [sp.preflop.scenario, sp.preflop.openerPos, sp.preflop.openSize, sp.preflop.callers], ['vsOpen', 'CO', 2.5, 0]);
eq('hero to act, to call', [sp.meta.heroToAct, sp.meta.toCall, sp.meta.pot], [true, 2.5, 4]);
// 2) hero 3-bets 7.5, blinds fold, CO calls -> flop, CO checks
act(tr, 'raise', 7.5); act(tr, 'fold'); act(tr, 'fold'); act(tr, 'call');
eq('round closed after CO call', state(tr).toAct, null);
nextStreet(tr);
eq('flop first to act = CO', state(tr).toAct, 'CO');
act(tr, 'check');
sp = trackerSpot(tr);
eq('3bet pot postflop', [sp.postflop.potType, sp.postflop.heroAggressor, sp.postflop.villainPos, sp.postflop.heroIP, sp.postflop.pot, sp.postflop.facing, sp.postflop.villainChecked], ['3bet', true, 'CO', true, 16.5, 'none', true]);
// 3) hero bets 5.5, CO raises to 16 -> hero faces a raise
act(tr, 'bet', 5.5); act(tr, 'raise', 16);
sp = trackerSpot(tr);
eq('facing check-raise', [sp.postflop.facing, sp.postflop.bet, sp.postflop.heroBet, sp.meta.toCall], ['raise', 16, 5.5, 10.5]);
// undo restores
undo(tr); sp = trackerSpot(tr);
eq('undo -> CO to act again', [state(tr).toAct, sp.meta.heroToAct], ['CO', false]);
// 4) limp: UTG limps, fold to hero on BTN
tr = newTrack({ size: 6, heroPos: 'BTN' });
act(tr, 'call'); foldToHero(tr);
sp = trackerSpot(tr);
eq('limped pot', [sp.preflop.scenario, sp.preflop.limpers, sp.meta.heroToAct], ['limped', 1, true]);
// 5) heads-up: BTN opens, hero BB
tr = newTrack({ size: 2, heroPos: 'BB' });
act(tr, 'raise', 2.5);
sp = trackerSpot(tr);
eq('HU vsOpen', [sp.preflop.scenario, sp.preflop.openerPos, sp.meta.toCall], ['vsOpen', 'BTN', 1.5]);
// 6) hero opens CO, BTN 3-bets -> vs3bet
tr = newTrack({ size: 6, heroPos: 'CO' });
foldToHero(tr); act(tr, 'raise', 2.5); act(tr, 'raise', 8);
foldToHero(tr);
sp = trackerSpot(tr);
eq('vs3bet', [sp.preflop.scenario, sp.preflop.openerPos, sp.preflop.heroOpen, sp.preflop.openSize], ['vs3bet', 'BTN', 2.5, 8]);
// 7) options sizes for an unopened pot
tr = newTrack({ size: 6, heroPos: 'BTN' });
foldToHero(tr);
eq('open sizes', options(tr).sizes, [2, 2.5, 3, 4]);
// 8) everybody folds to BB -> hand over
tr = newTrack({ size: 6, heroPos: 'BTN' });
for (let i = 0; i < 5; i++) act(tr, 'fold');
eq('walk', [state(tr).done, state(tr).winner], [true, 'BB']);
console.log(describeTrack(newTrack({ size: 6, heroPos: 'BTN' })));
console.log(bad ? `FAILED (${bad})` : 'tracker OK');
if (bad) process.exit(1);
