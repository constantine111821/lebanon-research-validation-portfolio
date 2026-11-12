// Presentation state only, scoped to the mounted workspace and case/view.
// No storage, telemetry, research mutation or draft serialization.
export function createDisclosures(root, window) {
  const states = new Map();
  let scope = '';
  let focused = null;
  const key = element => `${scope}|${element.dataset.disclosureKey}`;
  function capture() {
    const summary = root.ownerDocument.activeElement?.closest('summary');
    const details = summary?.parentElement;
    focused = root.contains(summary) && details?.dataset.disclosureKey ? key(details) : null;
    for (const element of root.querySelectorAll('details[data-disclosure-key]'))
      states.set(key(element), element.open);
  }
  function reveal(element) {
    if (!element) return;
    for (let parent = element.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    capture();
  }
  function anchorTarget(hash) {
    try { return root.ownerDocument.getElementById(decodeURIComponent(hash.slice(1))); }
    catch { return null; }
  }
  function jump(element) {
    reveal(element);
    const incident = element.closest('[data-incident-review]');
    const header = incident && root.querySelector('.topbar');
    if (header) incident.style.setProperty('--incident-scroll-margin', `${Math.ceil(header.getBoundingClientRect().height) + 12}px`);
    const heading = root.ownerDocument.getElementById(element.getAttribute('aria-labelledby') || '');
    const target = heading && element.contains(heading) ? heading : element;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus?.({ preventScroll: true });
    element.scrollIntoView?.({ block: 'start' });
  }
  function anchor() {
    const element = anchorTarget(window.location.hash);
    if (element && root.contains(element)) jump(element);
  }
  function restore(nextScope) {
    scope = nextScope;
    for (const element of root.querySelectorAll('details[data-disclosure-key]')) {
      if (states.has(key(element))) element.open = states.get(key(element));
      if (focused === key(element)) element.querySelector(':scope > summary')?.focus({ preventScroll: true });
    }
  }
  const toggle = event => {
    if (root.contains(event.target) && event.target.matches('details[data-disclosure-key]'))
      states.set(key(event.target), event.target.open);
  };
  const click = event => {
    const link = event.target.closest('a[href^="#"]');
    const href = link?.getAttribute('href');
    if (!href || href === '#') return;
    const incident = link.closest('[data-incident-review]');
    const destination = incident && anchorTarget(href);
    if (destination && incident.contains(destination) && !event.defaultPrevented &&
        event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      // Keep the incident and private draft identifier in the workspace URL.
      event.preventDefault();
      jump(destination);
      return;
    }
    window.setTimeout(anchor, 0);
  };
  root.addEventListener('toggle', toggle, true);
  root.addEventListener('click', click);
  window.addEventListener('hashchange', anchor);
  return { capture, restore, reveal, anchor, dispose() {
    root.removeEventListener('toggle', toggle, true);
    root.removeEventListener('click', click);
    window.removeEventListener('hashchange', anchor);
    states.clear();
  } };
}
