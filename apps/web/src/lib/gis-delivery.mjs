import { createHash } from "node:crypto";

// A process-local admission bound, not a shared cache or a durable job queue.
// One full projection per instance protects other requests from concurrent
// multi-hundred-MiB allocations. Other instances retain their own bound.
let exporting = false;
export function acquireGISProjection() {
  if (exporting) return null;
  exporting = true;
  let released = false;
  return () => { if (!released) { released = true; exporting = false; } };
}

export function gisCSVStream(csv, receipt, release) {
  const bytes = Buffer.from(csv, "utf8");
  if (bytes.length !== receipt.content_length_bytes ||
      createHash("sha256").update(bytes).digest("hex") !== receipt.content_sha256)
    throw Error("GIS_GENERATED_CONTENT_MISMATCH");
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) { release(); controller.close(); return; }
      const end = Math.min(offset + 65536, bytes.length);
      controller.enqueue(bytes.subarray(offset, end)); offset = end;
    },
    cancel() { release(); },
  });
}
