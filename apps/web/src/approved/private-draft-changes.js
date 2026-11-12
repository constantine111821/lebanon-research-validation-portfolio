// Only the owner's working proposal is edited. Shared records never enter this plan.
export function planPrivateChangeRemoval(pending, index, recordedSourceIds) {
  if (!Number.isInteger(index) || !pending[index])
    throw Error("This private change is no longer available. Reopen your draft.");

  const removed = new Set([index]);
  const removedFacts = new Set();
  const selected = pending[index];
  if (selected.type === "new_fact" && selected.claim?.claim_id)
    removedFacts.add(selected.claim.claim_id);

  // A causal proposal can refer to another staged fact. Preserve unrelated work,
  // but include dependent proposals and their own dependents in the confirmation.
  let expanded = true;
  while (expanded) {
    expanded = false;
    pending.forEach((change, position) => {
      if (removed.has(position)) return;
      const value = change.claim || change.task || change;
      if (![value.claim_id, value.attack_claim_id, value.effect_claim_id].some(id => removedFacts.has(id))) return;
      removed.add(position);
      if (change.type === "new_fact" && change.claim?.claim_id) {
        removedFacts.add(change.claim.claim_id);
        expanded = true;
      }
    });
  }

  const availableSources = new Set(recordedSourceIds);
  const retained = pending.filter((_, position) => !removed.has(position));
  for (const change of retained) {
    if (change.source?.source_id) availableSources.add(change.source.source_id);
  }
  const removedSources = new Map();
  for (const position of removed) {
    const source = pending[position].source;
    if (source?.source_id) removedSources.set(source.source_id, source);
  }
  const changes = retained.map(change => {
    const id = change.source_id;
    if (change.type !== "evidence" || !id || availableSources.has(id) || !removedSources.has(id))
      return change;
    availableSources.add(id);
    // Only the first surviving link needs to carry the unpublished source.
    const replacement = { ...change, source: removedSources.get(id) };
    delete replacement.source_id;
    return replacement;
  });
  return { changes, removedCount: removed.size };
}
