import { AccessError, authorizedActor } from "@/lib/access";
import { boundedBody, checkOrigin, failure, json } from "@/lib/http";
import { privateNoteDelete, privateNotePayload, privateNoteSave } from "@/lib/private-note-input";

async function noteActor(request: Request) {
  const actor = await authorizedActor();
  if (!request.headers.get("x-rvw-actor"))
    throw new AccessError(409, "WORKSPACE_ACTOR_CHANGED");
  return actor;
}

function mutationActor(request: Request) {
  checkOrigin(request);
  return noteActor(request);
}

function noteConflict(error: {code?: string} | null) {
  if (!error) return;
  if (["PT409", "40001"].includes(error.code || ""))
    throw new AccessError(409, "PRIVATE_NOTE_CONFLICT");
  throw error;
}

export async function GET(request: Request) {
  try {
    const { client, userId } = await noteActor(request);
    const { data, error } = await client.from("lab_private_drafts")
      .select("id,revision,payload,updated_at")
      .eq("owner_id", userId).like("id", "note:%")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return json((data || []).flatMap(row => {
      const note = privateNotePayload.safeParse(row.payload);
      return note.success ? [{ ...row, payload: note.data }] : [];
    }));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { client } = await mutationActor(request);
    const input = privateNoteSave.safeParse(await boundedBody(request, 100000));
    if (!input.success) throw new AccessError(400, "INVALID_PRIVATE_NOTE");
    const { id, expected_revision, payload } = input.data;
    if (payload.context_kind === "incident") {
      const { data, error } = await client.from("incident").select("id")
        .eq("id", payload.context_id).maybeSingle();
      if (error) throw error;
      if (!data) throw new AccessError(404, "CASE_NOT_FOUND");
    }
    const { data, error } = await client.rpc("lab_save_draft", {
      p_id: id, p_expected_revision: expected_revision, p_payload: payload,
    });
    noteConflict(error);
    return json({ id: data.id, revision: data.revision, payload: data.payload, updated_at: data.updated_at });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { client } = await mutationActor(request);
    const input = privateNoteDelete.safeParse(await boundedBody(request, 4096));
    if (!input.success) throw new AccessError(400, "INVALID_PRIVATE_NOTE");
    const { data, error } = await client.rpc("lab_delete_draft", {
      p_id: input.data.id, p_expected_revision: input.data.expected_revision,
    });
    noteConflict(error);
    return json(data);
  } catch (error) {
    return failure(error);
  }
}
