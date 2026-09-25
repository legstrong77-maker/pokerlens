// Runs the analysis engine off the main thread.
import { analyze } from './core/strategy.js';
import { equityJob } from './core/jobs.js';

self.onmessage = (e) => {
  const { id, kind, payload } = e.data || {};
  try {
    let result;
    if (kind === 'analyze') result = analyze(payload);
    else if (kind === 'equity') result = equityJob(payload);
    else throw new Error('unknown job ' + kind);
    if (result && result.hand && result.hand.outs) result.hand = { ...result.hand, outs: undefined };
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
