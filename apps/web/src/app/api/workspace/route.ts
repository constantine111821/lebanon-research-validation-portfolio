import {
  authorizedWorkspace,
  incrementalWorkspace,
  AccessError,
} from "@/lib/access";
import { failure, json } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const start = performance.now();
    const params = new URL(request.url).searchParams;
    if (params.has("version")) {
      const version = params.get("version") || null;
      if (version && !/^[a-f0-9]{64}$/.test(version))
        throw new AccessError(400, "INVALID_WORKSPACE_VERSION");
      const { result, authMs, rpcMs } = await incrementalWorkspace(version);
      const response = json(result);
      response.headers.set(
        "Server-Timing",
        `auth;dur=${authMs.toFixed(2)},rpc;dur=${rpcMs.toFixed(2)},workspace;dur=${(performance.now() - start).toFixed(2)}`,
      );
      return response;
    }
    const { snapshot, authMs, rpcMs } = await authorizedWorkspace();
    const response = json(snapshot);
    response.headers.set(
      "Server-Timing",
      `auth;dur=${authMs.toFixed(2)},rpc;dur=${rpcMs.toFixed(2)},workspace;dur=${(performance.now() - start).toFixed(2)}`,
    );
    return response;
  } catch (error) {
    return failure(error);
  }
}
