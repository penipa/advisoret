import type { SupabaseClient } from "@supabase/supabase-js";

export type VenueSuggestionKind = "report" | "edit" | "create";

export async function createVenueReport(
  supabase: SupabaseClient,
  args: {
    venueId: string;
    reason: string;
    message?: string;
    payload?: Record<string, any>;
  }
): Promise<void> {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;

  const user = userRes?.user;
  if (!user) throw new Error("No has iniciado sesión.");

  const { error } = await supabase.from("venue_suggestions").insert({
    venue_id: args.venueId,
    user_id: user.id,
    kind: "report",
    reason: args.reason || null,
    message: (args.message || "").trim() || null,
    payload: args.payload ?? {},
    status: "pending",
  });

  if (error) throw error;
}
