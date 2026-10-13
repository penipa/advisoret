import { supabase } from "../supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function materializeOverturePlace(
  externalId: string,
  release: string,
): Promise<string> {
  const normalizedExternalId = externalId.trim().toLowerCase();
  const normalizedRelease = release.trim();

  if (!UUID_PATTERN.test(normalizedExternalId)) {
    throw new Error("external_id must be a canonical lowercase UUID.");
  }

  if (!normalizedRelease) {
    throw new Error("release must not be empty.");
  }

  const { data, error } = await supabase.functions.invoke("materialize-overture-place", {
    body: {
      external_id: normalizedExternalId,
      release: normalizedRelease,
    },
  });

  if (error) throw new Error(error.message || "Could not materialize Overture place.");

  const venueId = data && typeof data === "object" && !Array.isArray(data)
    ? (data as { venue_id?: unknown }).venue_id
    : undefined;

  if (typeof venueId !== "string" || !UUID_PATTERN.test(venueId)) {
    throw new Error("materialize-overture-place returned an invalid venue_id.");
  }

  return venueId;
}
