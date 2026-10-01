import { runEnsemble } from './forecast.js';

self.onmessage = (e) => {
  const { id, snapshot, options } = e.data;
  try {
    const result = runEnsemble(snapshot, {
      ...options,
      onProgress: (p) => self.postMessage({ id, type: 'progress', progress: p }),
    });
    self.postMessage({ id, type: 'done', result });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.message || err) });
  }
};
