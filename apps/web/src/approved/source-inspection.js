// Temporary DOM navigation only. Retains the actual form nodes; no serialization or storage.
export function createSourceInspection(dialog) {
  let prior = null;
  function resume() {
    if (!prior) return false;
    const saved = prior;
    prior = null;
    dialog.replaceChildren(saved.nodes);
    for (const key of Object.keys(dialog.dataset)) delete dialog.dataset[key];
    Object.assign(dialog.dataset, saved.dataset);
    dialog.scrollTop = saved.scroll;
    if (saved.focus?.isConnected) saved.focus.focus({ preventScroll: true });
    return true;
  }
  const cancel = (event) => {
    if (prior) {
      event.preventDefault();
      resume();
    }
  };
  dialog.addEventListener("cancel", cancel);
  return {
    open(render) {
      if (dialog.open && !prior) {
        prior = {
          nodes: dialog.ownerDocument.createDocumentFragment(),
          dataset: { ...dialog.dataset },
          scroll: dialog.scrollTop,
          focus: dialog.ownerDocument.activeElement,
        };
        prior.nodes.append(...dialog.childNodes);
      }
      render(Boolean(prior));
    },
    resume,
    dispose() {
      prior = null;
      dialog.removeEventListener("cancel", cancel);
    },
  };
}
