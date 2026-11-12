import { authorizedCorrections } from "@/lib/corrections-access";
import { failure, json } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const { snapshot } = await authorizedCorrections(
      new URL(request.url).searchParams.get("incident_id") || "",
    );
    return json(snapshot);
  } catch (error) {
    return failure(error);
  }
}
