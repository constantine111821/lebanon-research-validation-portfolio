import {
  AccessError,
  authorizedActor,
} from "@/lib/access";
import { saveInput, deleteInput, draftSaveSchema } from "@/lib/draft-input";
import { boundedBody, checkOrigin, failure, json } from "@/lib/http";
import { isPrivateNoteId } from "@/lib/private-note-input";
export async function GET() {
  try {
    const { client, userId } = await authorizedActor();
    const { data, error } = await client.from("lab_private_drafts")
      .select("id,owner_id,revision,payload,updated_at")
      .eq("owner_id", userId).not("id", "like", "note:%")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return json(data);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const parsed = draftSaveSchema.safeParse(await boundedBody(request));
    if (!parsed.success || isPrivateNoteId(parsed.data.id))
      throw new AccessError(400, "INVALID_DRAFT");
    const { client } = await authorizedActor();
    const body = parsed.data;
    // Indexed scope reads use the user's existing RLS, without deriving the
    // full workspace's readiness and history for a private draft save.
    const ids = [...new Set(body.payload.changes.flatMap(c =>
      c.type === "new_fact"
        ? [String((c.claim as Record<string, unknown>)?.claim_id || "")]
        : ["review", "evidence"].includes(String(c.type)) ? [String(c.claim_id || "")] : []
    ))];
    const [incidents, claims] = await Promise.all([
      body.payload.creation ? Promise.resolve({data: [], error: null}) :
        client.from("incident").select("id").eq("id", body.payload.incident_id),
      ids.length ? client.from("claim").select("id,incident_id").in("id", ids) :
        Promise.resolve({data: [], error: null}),
    ]);
    if (incidents.error) throw incidents.error;
    if (claims.error) throw claims.error;
    const input = saveInput(body, {records: {
      INCIDENT: (incidents.data || []).map(x => ({incident_id: x.id})),
      CLAIM: (claims.data || []).map(x => ({claim_id: x.id, incident_id: x.incident_id})),
    }});
    // No retries: one reviewed draft RPC, with an explicit expected revision.
    const { data, error } = await client.rpc("lab_save_draft", {
      p_id: input.id,
      p_expected_revision: input.expected_revision,
      p_payload: input.payload,
    });
    if (error) {
      if (["PT409", "40001"].includes(error.code))
        throw new AccessError(409, "DRAFT_CONFLICT");
      throw error;
    }
    return json(data);
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const { client } = await authorizedActor();
    const parsed = deleteInput.safeParse(await boundedBody(request, 4096));
    if (!parsed.success || isPrivateNoteId(parsed.data.id))
      throw new AccessError(400, "INVALID_DRAFT");
    const { data, error } = await client.rpc("lab_delete_draft", {
      p_id: parsed.data.id,
      p_expected_revision: parsed.data.expected_revision,
    });
    if (error) {
      if (["PT409", "40001"].includes(error.code))
        throw new AccessError(409, "DRAFT_CONFLICT");
      throw error;
    }
    return json(data);
  } catch (error) {
    return failure(error);
  }
}
