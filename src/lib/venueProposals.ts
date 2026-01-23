import type { SupabaseClient } from "@supabase/supabase-js";

export type VenueProposalStatus = "pending" | "approved" | "rejected";

export type CreateVenueProposalInput = {
  name: string;
  address_text?: string | null;
  city?: string | null;
  google_maps_url?: string | null;
  notes?: string | null;
  payload?: Record<string, any> | null;
};

export async function createVenueProposal(
  supabase: SupabaseClient,
  input: CreateVenueProposalInput
) {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("No hay sesión activa.");

  const { error } = await supabase.from("venue_proposals").insert({
    user_id: userId,
    name: input.name,
    address_text: input.address_text ?? null,
    city: input.city ?? null,
    google_maps_url: input.google_maps_url ?? null,
    notes: input.notes ?? null,
    payload: input.payload ?? null,
  });

  if (error) throw new Error(error.message);
}

export async function reviewVenueProposal(
  supabase: SupabaseClient,
  args: { id: string; status: "approved" | "rejected"; resolution_note: string; reviewed_by: string }
) {
  const { error } = await supabase
    .from("venue_proposals")
    .update({
      status: args.status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: args.reviewed_by,
      resolution_note: args.resolution_note,
    })
    .eq("id", args.id);

  if (error) throw new Error(error.message);
}
