import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

type DbError = {
  code?: string;
  message?: string;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function isIgnorable(error: DbError | null) {
  const code = String(error?.code ?? "");
  return code === "42P01" || code === "42703";
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runStep(label: string, op: () => Promise<{ error: DbError | null }>) {
  console.error("delete-account step start", { label });
  const { error } = await op();
  if (error && !isIgnorable(error)) {
    console.error("delete-account step failed", {
      label,
      message: error?.message ?? null,
      code: error?.code ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    });
    throw new Error(`${label}: ${error.message ?? "unknown error"}`);
  }
  console.error("delete-account step ok", { label });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  console.error("delete-account auth header debug", {
    hasAuthorizationUpper: Boolean(req.headers.get("Authorization")),
    hasAuthorizationLower: Boolean(req.headers.get("authorization")),
    authorizationLength: (req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "").length,
    startsWithBearer: (req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "").startsWith("Bearer "),
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return json(500, { error: "Missing Supabase environment variables" });
  }

  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "Missing bearer token" });
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return json(401, { error: "Missing bearer token" });
  }

  const payload = decodeJwtPayload(token);
  const userId = typeof payload?.sub === "string" && payload.sub ? payload.sub : null;

  if (!userId) {
    console.error("delete-account jwt decode failed", { hasToken: Boolean(token) });
    return json(401, { error: "Unauthorized" });
  }

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    let ratingIds: string[] = [];

    const ratingsRes = await admin.from("ratings").select("id").eq("user_id", userId);
    if (ratingsRes.error && !isIgnorable(ratingsRes.error)) {
      throw new Error(`Load ratings: ${ratingsRes.error.message ?? "unknown error"}`);
    }

    if (!ratingsRes.error) {
      ratingIds = ((ratingsRes.data ?? []) as Array<{ id: string | null }>)
        .map((row) => row.id)
        .filter((id): id is string => Boolean(id));
    }

    if (ratingIds.length > 0) {
      await runStep("Delete rating_scores", () =>
        admin.from("rating_scores").delete().in("rating_id", ratingIds)
      );
      await runStep("Delete rating_kudos on own ratings", () =>
        admin.from("rating_kudos").delete().in("rating_id", ratingIds)
      );
    }

    await runStep("Delete rating_kudos by user", () =>
      admin.from("rating_kudos").delete().eq("user_id", userId)
    );
    await runStep("Delete follows as follower", () =>
      admin.from("user_follows").delete().eq("follower_id", userId)
    );
    await runStep("Delete follows as followed", () =>
      admin.from("user_follows").delete().eq("followed_id", userId)
    );
    await runStep("Clear reviewed_by in venue_suggestions", () =>
      admin.from("venue_suggestions").update({ reviewed_by: null }).eq("reviewed_by", userId)
    );
    await runStep("Delete venue_suggestions", () =>
      admin.from("venue_suggestions").delete().eq("user_id", userId)
    );
    await runStep("Clear reviewed_by in venue_proposals", () =>
      admin.from("venue_proposals").update({ reviewed_by: null }).eq("reviewed_by", userId)
    );
    await runStep("Delete venue_proposals", () =>
      admin.from("venue_proposals").delete().eq("user_id", userId)
    );
    await runStep("Delete ratings", () =>
      admin.from("ratings").delete().eq("user_id", userId)
    );
    await runStep("Delete profile", () =>
      admin.from("profiles").delete().eq("id", userId)
    );

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      throw new Error(`Delete auth user: ${deleteUserError.message ?? "unknown error"}`);
    }

    return json(200, { ok: true });
  } catch (error) {
    console.error("delete-account failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const message = error instanceof Error ? error.message : "Unknown deletion error";
    return json(500, { error: message });
  }
});
