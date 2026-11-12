import { NextResponse } from "next/server";
import { AccessError } from "./access";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}
export function checkOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
  if (request.headers.get("origin") !== new URL(expected).origin)
    throw new AccessError(403, "ORIGIN_DENIED");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AccessError(415, "JSON_REQUIRED");
}
export async function boundedBody(
  request: Request,
  max = 250_000,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > max)
    throw new AccessError(413, "REQUEST_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new AccessError(413, "REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AccessError(400, "INVALID_JSON");
  }
}
export function failure(error: unknown) {
  if (error instanceof AccessError)
    return json({ error: error.code }, error.status);
  return json({ error: "WORKSPACE_UNAVAILABLE" }, 503);
}
