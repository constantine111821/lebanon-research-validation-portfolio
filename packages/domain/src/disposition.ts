export type DispositionState = "ACTIVE" | "DEFERRED" | "APPROVED";
export type DispositionAction = "DEFER" | "APPROVE" | "REOPEN";
export type DispositionLock = {
  locked: boolean;
  state: DispositionState | "DEPENDENCY_LOCKED";
  fact_disposition?: DispositionState;
  protection_state?:
    | "FACT_DISPOSITION"
    | "INCIDENT_COMPLETED"
    | "INCIDENT_DEFERRED"
    | "DEPENDENCY_LOCKED"
    | "UNLOCKED";
  incident_states?: Record<string, string>;
  reason: string;
  cause?: "fact" | "incident" | "dependency";
  incident_ids?: string[];
  protected_fact_ids?: string[];
};
type Snapshot = {
  dispositions?: {
    facts?: Record<string, { state?: DispositionState; reason?: string }>;
    incidents?: Record<string, { state?: DispositionState; reason?: string }>;
  };
  disposition_locks?: {
    facts?: Record<string, DispositionLock>;
    incidents?: Record<string, DispositionLock>;
  };
  workflow?: {
    incidents?: Record<
      string,
      { status?: string; required_claim_ids?: string[] }
    >;
  };
  records?: {
    CLAIM?: {
      claim_id: string;
      incident_id?: string;
      facility_id?: string;
      claim_family?: string;
      is_current?: boolean;
      attack_claim_id?: string;
      effect_claim_id?: string;
    }[];
    INCIDENT_FACILITY?: {
      incident_id: string;
      facility_id: string;
      is_current?: boolean;
    }[];
  };
};

export function dispositionState(
  s: Snapshot,
  type: "fact" | "incident",
  id: string,
): DispositionState {
  const state =
    s.dispositions?.[type === "fact" ? "facts" : "incidents"]?.[id]?.state;
  if (state === "DEFERRED" || state === "APPROVED") return state;
  if (
    type === "incident" &&
    ["complete", "review_complete", "supervisor_override"].includes(
      s.workflow?.incidents?.[id]?.status || "",
    )
  )
    return "APPROVED";
  return "ACTIVE";
}

export function incidentLock(s: Snapshot, id: string): DispositionLock {
  const supplied = s.disposition_locks?.incidents?.[id];
  if (supplied?.locked)
    return { ...supplied, cause: "incident", incident_ids: [id] };
  const state = dispositionState(s, "incident", id);
  return {
    locked: state !== "ACTIVE",
    state,
    reason:
      s.dispositions?.incidents?.[id]?.reason ||
      (state === "APPROVED"
        ? "Incident review is complete. A supervisor must reopen it before shared changes."
        : ""),
    cause: "incident",
    incident_ids: [id],
  };
}

export function factLock(s: Snapshot, id: string): DispositionLock {
  const supplied = s.disposition_locks?.facts?.[id];
  const state = dispositionState(s, "fact", id);
  // Never reinterpret a server protection reason as a factual disposition.
  if (supplied) return { ...supplied, state, fact_disposition: state };
  if (state !== "ACTIVE")
    return {
      locked: true,
      state,
      fact_disposition: state,
      protection_state: "FACT_DISPOSITION",
      reason: s.dispositions?.facts?.[id]?.reason || "",
      cause: "fact",
      incident_ids: [],
    };
  const fact = s.records?.CLAIM?.find((c) => c.claim_id === id);
  const scope = new Set(fact?.incident_id ? [fact.incident_id] : []);
  // Facility identity/type findings are shared by their linked incidents. Other
  // facts do not inherit a lock merely by using the same facility or source.
  if (["IDENTITY", "FACILITY_TYPE"].includes(fact?.claim_family || "")) {
    for (const link of s.records?.INCIDENT_FACILITY || [])
      if (link.facility_id === fact?.facility_id && link.is_current !== false)
        scope.add(link.incident_id);
  }
  for (const [iid, workflow] of Object.entries(s.workflow?.incidents || {}))
    if (workflow.required_claim_ids?.includes(id)) scope.add(iid);
  const shared = ["IDENTITY", "FACILITY_TYPE"].includes(
    fact?.claim_family || "",
  );
  const locked = [...scope].sort().filter((iid) => {
    const lock = incidentLock(s, iid);
    return (
      lock.locked &&
      (lock.state === "APPROVED" ||
        ["complete", "review_complete", "supervisor_override"].includes(
          s.workflow?.incidents?.[iid]?.status || "",
        ) ||
        (!shared && iid === fact?.incident_id))
    );
  });
  if (locked.length)
    return {
      ...incidentLock(s, locked[0]),
      state,
      fact_disposition: state,
      protection_state: locked.some(
        (iid) =>
          incidentLock(s, iid).state === "APPROVED" ||
          ["complete", "review_complete", "supervisor_override"].includes(
            s.workflow?.incidents?.[iid]?.status || "",
          ),
      )
        ? "INCIDENT_COMPLETED"
        : "INCIDENT_DEFERRED",
      incident_states: Object.fromEntries(
        locked.map((iid) => [iid, incidentLock(s, iid).state]),
      ),
      incident_ids: locked,
    };
  const dependent = (s.records?.CLAIM || [])
    .filter(
      (c) =>
        c.claim_family === "ATTACK_TO_EFFECT_CAUSATION" &&
        c.is_current !== false &&
        (c.attack_claim_id === id || c.effect_claim_id === id) &&
        dispositionState(s, "fact", c.claim_id) !== "ACTIVE",
    )
    .map((c) => c.claim_id)
    .sort();
  if (dependent.length)
    return {
      locked: true,
      state,
      fact_disposition: state,
      protection_state: "DEPENDENCY_LOCKED",
      cause: "dependency",
      protected_fact_ids: dependent,
      incident_ids: [],
      reason:
        "A deferred or approved causal fact depends on this finding. Reopen the dependent fact first.",
    };
  return {
    locked: false,
    state: "ACTIVE",
    fact_disposition: state,
    protection_state: "UNLOCKED",
    reason: "",
    cause: "fact",
    incident_ids: [],
  };
}

export function facilityLock(s: Snapshot, fid: string): DispositionLock {
  const ids = (s.records?.INCIDENT_FACILITY || [])
    .filter((l) => l.facility_id === fid && l.is_current !== false)
    .map((l) => l.incident_id);
  const active = ids.some((iid) => !incidentLock(s, iid).locked);
  const protectedIncident = ids.find(
    (iid) =>
      incidentLock(s, iid).locked &&
      (incidentLock(s, iid).state === "APPROVED" ||
        !active ||
        ["complete", "review_complete", "supervisor_override"].includes(
          s.workflow?.incidents?.[iid]?.status || "",
        )),
  );
  if (protectedIncident) return incidentLock(s, protectedIncident);
  const protectedFact = (s.records?.CLAIM || []).find(
    (c) =>
      c.facility_id === fid &&
      c.is_current !== false &&
      ["IDENTITY", "FACILITY_TYPE"].includes(c.claim_family || "") &&
      factLock(s, c.claim_id).locked,
  );
  return protectedFact
    ? factLock(s, protectedFact.claim_id)
    : { locked: false, state: "ACTIVE", reason: "" };
}

export function transitionAllowed(
  state: DispositionState,
  action: DispositionAction,
) {
  return state === "ACTIVE"
    ? action === "DEFER" || action === "APPROVE"
    : action === "REOPEN";
}

export function dispositionLabel(
  state: DispositionState | "DEPENDENCY_LOCKED",
  type: "fact" | "incident" = "fact",
) {
  return state === "DEPENDENCY_LOCKED"
    ? "Protected by dependent fact"
    : state === "DEFERRED"
      ? "Deferred by supervisor"
      : state === "APPROVED"
        ? type === "incident"
          ? "Approved by supervisor · incident complete"
          : "Approved by supervisor"
        : "Active review";
}

export function lockMessage(lock: DispositionLock) {
  if (!lock.locked) return "";
  if (
    lock.cause === "dependency" ||
    lock.protection_state === "DEPENDENCY_LOCKED" ||
    lock.state === "DEPENDENCY_LOCKED"
  )
    return `Protected by dependent fact. ${lock.reason || "A supervisor must reopen the protected dependent fact before this finding can change."} This does not approve or defer the predecessor finding. Evidence and history remain readable; private drafts are preserved.`;
  if (lock.cause === "incident")
    return `${lock.protection_state === "INCIDENT_COMPLETED" || lock.state === "APPROVED" ? "Protected by a completed incident." : "Editing locked for this incident."} ${lock.reason || "A supervisor must reopen the protected incident before shared changes."} Evidence and history remain readable; private drafts are preserved.`;
  return `Fact ${lock.state === "DEFERRED" ? "deferred" : "approved"} by supervisor. ${lock.reason || "A supervisor must reopen it before shared changes."} Evidence and history remain readable; private drafts are preserved.`;
}
