import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { records as syntheticRecords } from "./records.mjs";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const users = {
  researcher: {
    id: "10000000-0000-4000-8000-000000000001",
    email: "researcher@example.invalid",
    name: "Researcher One",
    role: "researcher",
    active: true,
  },
  researcher2: {
    id: "10000000-0000-4000-8000-000000000002",
    email: "researcher2@example.invalid",
    name: "Researcher Two",
    role: "researcher",
    active: true,
  },
  supervisor: {
    id: "10000000-0000-4000-8000-000000000003",
    email: "supervisor@example.invalid",
    name: "Supervisor",
    role: "supervisor",
    active: true,
  },
  unprofiled: {
    id: "10000000-0000-4000-8000-000000000004",
    email: "unprofiled@example.invalid",
    name: "No Profile",
    role: null,
    active: true,
  },
  inactive: {
    id: "10000000-0000-4000-8000-000000000005",
    email: "inactive@example.invalid",
    name: "Inactive Researcher",
    role: "researcher",
    active: false,
  },
};
export async function createDatabase() {
  const database = new PGlite();
  await database.waitReady;
  const support = path.join(root, "tests/support");
  await database.exec(fs.readFileSync(path.join(support, "auth-stub.sql"), "utf8"));
  for (const user of Object.values(users))
    await database.query("insert into auth.users(id,email) values($1,$2)", [
      user.id,
      user.email,
    ]);
  const schema = path.join(support, "schema");
  for (const file of fs.readdirSync(schema).sort())
    await database.exec(fs.readFileSync(path.join(schema, file), "utf8"));
    const ids = {
      facility: "facility_id",
      incident: "incident_id",
      incident_facility: "incident_facility_id",
      claim: "claim_id",
      source: "source_id",
      claim_source: "claim_source_id",
    };
    const records = syntheticRecords();
    for (const [table, key] of Object.entries(ids)) {
      const { rows: [count] } = await database.query(`select count(*)::int as n from public.${table}`);
      if (count.n !== 0) throw Error("Synthetic test database contains historical records.");
      for (const row of records[table])
        await database.query(`insert into public.${table}(id,data) values($1,$2)`, [row[key], row]);
    }
    await database.exec(
      "insert into public.lab_incident_workflow(incident_id,status) select id,'in_progress' from public.incident; " +
      "insert into public.lab_claim_workflow(claim_id) select id from public.claim; " +
      "insert into public.lab_seed_metadata(id,data) values('approved_classifications','[]'),('manifest','{\"synthetic_only\":true}');",
    );
  for (const user of Object.values(users).filter((u) => u.role))
    await database.query(
      "insert into public.lab_profiles(user_id,display_name,role,active) values($1,$2,$3,$4)",
      [user.id, user.name, user.role, user.active],
    );
  // Give the public export a current fictional review and its matching evidence.
  const reviewer = users.supervisor.id;
  const reviewedAt = "2026-11-04T12:00:00Z";
  for (const kind of ["IDENTITY", "TYPE"]) {
    const claimId = "C-SYN019-" + kind;
    const auditId = "A-SYN019-PERIODICAL-" + kind;
    const link = records.claim_source.find(row => row.claim_source_id === "E-SYN019-" + kind);
    const source = records.source.find(row => row.source_id === link.source_id);
    const approvalBasis = [{
      id: link.claim_source_id,
      revision: 1,
      data: link,
      source: { id: source.source_id, revision: 1, data: source },
    }];
    const reviewArtifact = {
      claim_id: claimId,
      prior_revision: 1,
      reviewer,
      reviewed_at: reviewedAt,
      proposal: { validation_state: "SUPPORTED" },
      approval_basis: approvalBasis,
    };
    await database.query(
      "update public.claim set revision=2,data=data||$2::jsonb where id=$1",
      [claimId, { current_value_authority: { authority_artifact: auditId } }],
    );
    await database.query(
      "update public.lab_claim_workflow set lab_review_state='REVIEWED',review_needed=false,lab_reviewed_claim_revision=2,lab_reviewed_by=$2,lab_reviewed_at=$3 where claim_id=$1",
      [claimId, reviewer, reviewedAt],
    );
    await database.query("insert into public.activity_log(id,data) values($1,$2)", [auditId, {
      activity_id: auditId,
      entity_type: "CLAIM",
      entity_id: claimId,
      incident_id: "I-SYN019-MAIN",
      action_type: "validate",
      actor_role: "supervisor",
      actor: reviewer,
      timestamp: reviewedAt,
      authority_artifact: { payload: { operation: { review_artifact: reviewArtifact } } },
    }]);
  }
  let queue = Promise.resolve();
  function serial(work) {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }
  async function as(userId, work, role = "authenticated") {
    if (!["authenticated", "anon"].includes(role))
      throw new Error("Invalid test role");
    return serial(async () => {
      await database.exec("begin");
      try {
        await database.exec(`set local role ${role}`);
        await database.query(
          "select set_config('request.jwt.claim.sub',$1,true)",
          [userId || ""],
        );
        const result = await work(database);
        await database.exec("commit");
        return result;
      } catch (error) {
        await database.exec("rollback");
        throw error;
      }
    });
  }
  async function rpc(userId, name, args = []) {
    if (
      ![
        "lab_snapshot",
        "lab_snapshot_if_changed",
        "lab_actor_profile",
        "lab_save_draft",
        "lab_delete_draft",
        "lab_commit",
        "lab_analytics_read",
      ].includes(name)
    )
      throw new Error("Unknown RPC");
    return as(
      userId,
      async (db) =>
        (
          await db.query(
            `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
            args,
          )
        ).rows[0].result,
    );
  }
  return { database, as, rpc, serial, close: () => database.close() };
}
