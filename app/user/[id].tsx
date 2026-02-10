import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, ScrollView, View, Pressable, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";
import { useTranslation } from "react-i18next";

type Profile = {
  id: string;
  display_name: string | null;
  username: string | null;
};

type RatingRow = {
  venue_id: string;
  overall_score: number;
  created_at: string;
};

type VenueMini = {
  id: string;
  name: string;
  city: string;
  address_text?: string | null;
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

function shortId(id: string) {
  if (!id) return "usuario";
  return id.slice(0, 6);
}

export default function UserProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const profileId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [meId, setMeId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [venues, setVenues] = useState<Array<{ venue: VenueMini; score: number; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const displayName = useMemo(() => {
    const label = (profile?.display_name ?? profile?.username ?? "").trim();
    if (label) return label;
    return profileId ? `@${shortId(profileId)}` : t("user.userFallback");
  }, [profile, profileId, t]);

  useEffect(() => {
    if (!profileId) return;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const u = await supabase.auth.getUser();
        const myId = u.data.user?.id ?? null;
        setMeId(myId);

        // Profile (si no existe, no rompemos)
        const p = await supabase.from("profiles").select("id,display_name,username").eq("id", profileId).maybeSingle();
        if (!p.error && p.data) setProfile(p.data as Profile);

        // ¿Lo sigo?
        if (myId && myId !== profileId) {
          const f = await supabase
            .from("follows")
            .select("follower_id")
            .eq("follower_id", myId)
            .eq("following_id", profileId)
            .maybeSingle();

          setIsFollowing(!!f.data && !f.error);
        }

        // Recomendaciones (últimas valoraciones → dedupe venues)
        const rr = await supabase
          .from("vw_rating_overall")
          .select("venue_id,overall_score,created_at")
          .eq("user_id", profileId)
          .order("created_at", { ascending: false })
          .limit(200);

        if (rr.error) throw new Error(rr.error.message);

        const seen = new Set<string>();
        const ordered: Array<{ venue_id: string; score: number; created_at: string }> = [];
        for (const row of (rr.data ?? []) as any[]) {
          const vid = row.venue_id as string;
          if (!vid || seen.has(vid)) continue;
          seen.add(vid);
          ordered.push({ venue_id: vid, score: Number(row.overall_score ?? 0), created_at: row.created_at });
          if (ordered.length >= 25) break;
        }

        if (ordered.length === 0) {
          setVenues([]);
          setLoading(false);
          return;
        }

        const ids = ordered.map((x) => x.venue_id);
        const vv = await supabase.from("venues").select("id,name,city,address_text").in("id", ids);
        if (vv.error) throw new Error(vv.error.message);

        const map = new Map<string, VenueMini>();
        for (const v of (vv.data ?? []) as any[]) map.set(v.id, v);

        const final = ordered
          .map((x) => {
            const v = map.get(x.venue_id);
            if (!v) return null;
            return { venue: v, score: x.score, created_at: x.created_at };
          })
          .filter(Boolean) as Array<{ venue: VenueMini; score: number; created_at: string }>;

        setVenues(final);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [profileId]);

  const toggleFollow = async () => {
    if (!meId || !profileId) return;
    if (meId === profileId) return;

    setBusy(true);
    try {
      if (isFollowing) {
        const d = await supabase.from("follows").delete().eq("follower_id", meId).eq("following_id", profileId);
        if (d.error) throw new Error(d.error.message);
        setIsFollowing(false);
      } else {
        const ins = await supabase.from("follows").insert({ follower_id: meId, following_id: profileId });
        if (ins.error) throw new Error(ins.error.message);
        setIsFollowing(true);
      }
    } catch (e: any) {
      Alert.alert(t("user.errors.updateFailedTitle"), e?.message ?? t("user.errors.tryAgain"));
    } finally {
      setBusy(false);
    }
  };

  const goVenue = (venueId: string) => {
    router.push({ pathname: "/venue/[id]", params: { id: venueId } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TText size={theme.font.title} weight="800">
            {displayName}
          </TText>

          {meId && profileId && meId !== profileId ? (
            <TButton
              title={isFollowing ? t("user.following") : t("user.follow")}
              variant={isFollowing ? "ghost" : "primary"}
              disabled={busy}
              onPress={() => void toggleFollow()}
            />
          ) : null}
        </View>

        {error && (
          <TText style={{ color: theme.colors.danger, marginTop: theme.spacing.md }}>
            {error}
          </TText>
        )}

        <View style={{ marginTop: theme.spacing.lg }}>
          <TText size={theme.font.h2} weight="700">
            {t("user.recommendations")}
          </TText>

          {loading ? (
            <TText muted style={{ marginTop: 10 }}>
              Cargando…
            </TText>
          ) : venues.length === 0 ? (
            <TText muted style={{ marginTop: 10 }}>
              {t("user.noRatings")}
            </TText>
          ) : (
            <View style={{ marginTop: theme.spacing.sm }}>
              {venues.map((it) => (
                <Pressable key={`${it.venue.id}-${it.created_at}`} onPress={() => goVenue(it.venue.id)}>
                  <TCard style={{ marginBottom: theme.spacing.sm }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <TText weight="800">{it.venue.name}</TText>
                        <TText muted style={{ marginTop: 6 }}>
                          {it.venue.city}
                          {it.venue.address_text ? ` · ${it.venue.address_text}` : ""}
                        </TText>
                        <TText muted style={{ marginTop: 6 }}>
                          {fmtDate(it.created_at)}
                        </TText>
                      </View>

                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: "transparent",
                        }}
                      >
                        <TText size={12} weight="800" style={{ color: "#C9A35C" }}>
                          {Number(it.score ?? 0).toFixed(1)}
                        </TText>
                      </View>
                    </View>
                  </TCard>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
