// One mounted owner's queue. No persistent browser cache, polling, or shared writes.
export const fingerprint = value => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);

export function createPrivateAutosave({save, status, delay = 1800}) {
  let latest = null, acknowledged = '', timer, flight = null, stopped = false, held = false;
  let state = 'Unsaved changes', failure = null;
  const emit = (next, error = null) => { state = next; failure = error; status(next, error); };
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const dirty = () => Boolean(latest && fingerprint(latest) !== acknowledged);
  function schedule() {
    cancel();
    if (!stopped && !held && dirty() && !flight && !failure)
      timer = setTimeout(() => { void flush().catch(() => {}); }, delay);
  }
  function update(value) {
    if (fingerprint(latest) === fingerprint(value)) return;
    latest = value ? structuredClone(value) : null;
    cancel();
    if (!flight && !failure) emit(dirty() ? 'Unsaved changes' : 'Saved privately');
    schedule();
  }
  async function flush({retry = false} = {}) {
    cancel();
    if (flight) { await flight; return flush({retry}); }
    if (failure && (!retry || state === 'Conflicted')) throw failure;
    if (stopped || !dirty()) return;
    failure = null;
    const value = structuredClone(latest), sent = fingerprint(value);
    emit('Saving');
    flight = (async () => {
      try {
        await save(value);
        acknowledged = sent;
        emit(dirty() ? 'Unsaved changes' : 'Saved privately');
      } catch (error) {
        emit(error.code === 'DRAFT_CONFLICT' ? 'Conflicted' : 'Save failed', error);
        throw error;
      }
    })();
    try { await flight; } finally { flight = null; schedule(); }
  }
  return {
    update, flush, dirty,
    hold() { held = true; cancel(); },
    release() { held = false; schedule(); },
    get state() { return state; },
    get running() { return flight; },
    checkpoint() { return {latest:structuredClone(latest), acknowledged, state, failure}; },
    resume(saved) { cancel(); latest=structuredClone(saved.latest); acknowledged=saved.acknowledged; emit(saved.state,saved.failure); schedule(); },
    // Only an explicit restore/reset may adopt another revision after conflict.
    restore(value) { cancel(); latest = value ? structuredClone(value) : null; acknowledged = value ? fingerprint(value) : ''; failure = null; emit('Saved privately'); },
    stop() { stopped = true; cancel(); },
  };
}
