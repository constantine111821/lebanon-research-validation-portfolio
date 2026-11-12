export function assignmentMembers(assignment) {
  if (Array.isArray(assignment?.assigned_researchers))
    return assignment.assigned_researchers;
  return assignment?.assigned_to ? [assignment.assigned_to] : [];
}

export function caseAssignment(snapshot, incidentId) {
  return snapshot.assignments?.[incidentId] ?? snapshot.workflow?.assignments?.[incidentId];
}

export function assignmentNames(snapshot, members) {
  return members.map((id) =>
    snapshot.team?.find((person) => (person.user_id || person.id) === id)?.display_name ||
    (snapshot.profile?.user_id === id ? snapshot.profile.display_name : "Unavailable lab member")
  ).join(", ") || "Unassigned";
}
