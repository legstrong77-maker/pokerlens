// Talks to the analysis worker; falls back to running on the main thread.
let worker = null, seq = 0, fallback = null;
const pending = new Map();

function ensureWorker() {
  if (worker || fallback) return;
  try {
    worker = new Worker(new URL('../engine.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      console.warn('worker failed, using main thread', e.message);
      worker = null;
      useFallback();
      for (const [id, p] of pending) { pending.delete(id); run(p.kind, p.payload).then(p.resolve, p.reject); }
    };
  } catch (err) {
    useFallback();
  }
}
function useFallback() {
  if (!fallback) {
    fallback = Promise.all([import('../core/strategy.js'), import('../core/jobs.js')])
      .then(([m, j]) => ({ analyze: m.analyze, equityJob: j.equityJob }));
  }
}
async function run(kind, payload) {
  const f = await fallback;
  if (kind === 'analyze') return f.analyze(payload);
  if (kind === 'equity' && f.equityJob) return f.equityJob(payload);
  throw new Error('no engine');
}

export function engine(kind, payload) {
  ensureWorker();
  if (!worker) return run(kind, payload);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, kind, payload });
    worker.postMessage({ id, kind, payload });
  });
}

/** Keep only the latest request of a given channel (drops stale results). */
const latest = new Map();
export function engineLatest(channel, kind, payload) {
  const token = Symbol(channel);
  latest.set(channel, token);
  return engine(kind, payload).then((r) => (latest.get(channel) === token ? r : null));
}
