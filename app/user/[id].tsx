import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, ScrollView, View, Pressable, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { Session } from "@supabase/supabase-js";

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

type ActivityItem = {
  rating_id: string;
  venue_id: string;
  product_type_id: string | null;
  created_at: string;
  price_eur: number | null;
  comment: string | null;
  overall_score: number | null;
};

type VenueMini = {
  id: string;
  name: string | null;
  city: string | null;
  address_text: string | null;
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

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  const [followLoading, setFollowLoading] = useState<boolean>(false);
  const [followInitLoading, setFollowInitLoading] = useState<boolean>(true);

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState<boolean>(true);
  const [venueById, setVenueById] = useState<Record<string, VenueMini>>({});
  const [kudosCountByRatingId, setKudosCountByRatingId] = useState<Record<string, number>>({});
  const [myKudosSet, setMyKudosSet] = useState<Set<string>>(new Set());
  const [kudosLoadingByRatingId, setKudosLoadingByRatingId] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const headerTitle = useMemo(() => profile?.display_name ?? profile?.username ?? "", [profile?.display_name, profile?.username]);

  const displayName = useMemo(() => {
    const label = (profile?.display_name ?? profile?.username ?? "").trim();
    if (label) return label;
    return profileId ? `@${shortId(profileId)}` : t("user.userFallback");
  }, [profile, profileId, t]);

  useEffect(() => {
    if (!profileId) return;

    (async () => {
      setError(null);
      setFollowInitLoading(true);
      setActivityLoading(true);

      try {
        const s = await supabase.auth.getSession();
        const currentSession = s.data.session ?? null;
        const myId = currentSession?.user?.id ?? null;
        setSession(currentSession);

        // Profile (si no existe, no rompemos)
        const p = await supabase.from("profiles").select("id,display_name,username").eq("id", profileId).maybeSingle();
        if (!p.error && p.data) setProfile(p.data as Profile);

        // ¿Lo sigo?
        if (!myId || myId === profileId) {
          setIsFollowing(false);
        } else {
          const f = await supabase
            .from("user_follows")
            .select("followed_id")
            .eq("follower_id", myId)
            .eq("followed_id", profileId)
            .maybeSingle();

          if (f.error) {
            Alert.alert(t("common.error"), f.error.message ?? "");
          } else {
            setIsFollowing(!!f.data);
          }
        }

        const activityRes = await supabase
          .from("vw_rating_overall")
          .select("rating_id, venue_id, product_type_id, created_at, price_eur, comment, overall_score")
          .eq("user_id", profileId)
          .order("created_at", { ascending: false })
          .limit(20);

        if (activityRes.error) {
          Alert.alert(t("common.error"), activityRes.error.message ?? "");
          setActivity([]);
          setVenueById({});
        } else {
          const nextActivity = (activityRes.data ?? []) as ActivityItem[];
          setActivity(nextActivity);

          const venueIds = Array.from(new Set(nextActivity.map((a) => a.venue_id).filter(Boolean)));
          if (venueIds.length === 0) {
            setVenueById({});
          } else {
            const venuesRes = await supabase.from("venues").select("id,name,city,address_text").in("id", venueIds);
            if (venuesRes.error) {
              Alert.alert(t("common.error"), venuesRes.error.message ?? "");
              setVenueById({});
            } else {
              const map: Record<string, VenueMini> = {};
              for (const v of (venuesRes.data ?? []) as VenueMini[]) {
                map[v.id] = v;
              }
              setVenueById(map);
            }
          }
        }
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setFollowInitLoading(false);
        setActivityLoading(false);
      }
    })();
  }, [profileId, t]);

  useEffect(() => {
    const ratingIds = activity.map((a) => a.rating_id).filter(Boolean);
    if (ratingIds.length === 0) {
      setKudosCountByRatingId({});
      setMyKudosSet(new Set());
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const countsRes = await supabase.from("rating_kudos").select("rating_id").in("rating_id", ratingIds);
        if (countsRes.error) throw new Error(countsRes.error.message);

        const counts: Record<string, number> = {};
        for (const row of (countsRes.data ?? []) as Array<{ rating_id: string }>) {
          const ratingId = row.rating_id;
          counts[ratingId] = (counts[ratingId] ?? 0) + 1;
        }
        if (!cancelled) setKudosCountByRatingId(counts);

        const meId = session?.user?.id;
        if (!meId) {
          if (!cancelled) setMyKudosSet(new Set());
          return;
        }

        const mineRes = await supabase
          .from("rating_kudos")
          .select("rating_id")
          .eq("user_id", meId)
          .in("rating_id", ratingIds);
        if (mineRes.error) throw new Error(mineRes.error.message);

        const nextSet = new Set<string>(((mineRes.data ?? []) as Array<{ rating_id: string }>).map((r) => r.rating_id));
        if (!cancelled) setMyKudosSet(nextSet);
      } catch (e: any) {
        if (!cancelled) Alert.alert(t("common.error"), e?.message ?? "");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activity, session?.user?.id, t]);

  const toggleFollow = async () => {
    const meId = session?.user?.id;
    if (!meId || !profileId) return;
    if (meId === profileId) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        const d = await supabase.from("user_follows").delete().eq("follower_id", meId).eq("followed_id", profileId);
        if (d.error) throw new Error(d.error.message);
        setIsFollowing(false);
      } else {
        const ins = await supabase.from("user_follows").insert({ follower_id: meId, followed_id: profileId });
        if (ins.error) throw new Error(ins.error.message);
        setIsFollowing(true);
      }
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "");
    } finally {
      setFollowLoading(false);
    }
  };

  const goVenue = (venueId: string) => {
    router.push({ pathname: "/venue/[id]", params: { id: venueId } });
  };

  const toggleKudos = async (ratingId: string) => {
    const meId = session?.user?.id;
    if (!meId || !ratingId) return;

    setKudosLoadingByRatingId((prev) => ({ ...prev, [ratingId]: true }));
    try {
      const hasKudos = myKudosSet.has(ratingId);

      if (hasKudos) {
        const delRes = await supabase.from("rating_kudos").delete().eq("rating_id", ratingId).eq("user_id", meId);
        if (delRes.error) throw new Error(delRes.error.message);

        setMyKudosSet((prev) => {
          const next = new Set(prev);
          next.delete(ratingId);
          return next;
        });
        setKudosCountByRatingId((prev) => ({
          ...prev,
          [ratingId]: Math.max(0, (prev[ratingId] ?? 0) - 1),
        }));
      } else {
        const insRes = await supabase.from("rating_kudos").insert({ rating_id: ratingId, user_id: meId });
        if (insRes.error) throw new Error(insRes.error.message);

        setMyKudosSet((prev) => {
          const next = new Set(prev);
          next.add(ratingId);
          return next;
        });
        setKudosCountByRatingId((prev) => ({
          ...prev,
          [ratingId]: (prev[ratingId] ?? 0) + 1,
        }));
      }
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "");
    } finally {
      setKudosLoadingByRatingId((prev) => ({ ...prev, [ratingId]: false }));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ title: headerTitle }} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TText size={theme.font.title} weight="800">
            {displayName}
          </TText>

          {session?.user?.id && profileId && session.user.id !== profileId ? (
            <TButton
              title={isFollowing ? t("user.following") : t("user.follow")}
              variant={isFollowing ? "ghost" : "primary"}
              disabled={followLoading || followInitLoading}
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
          {activityLoading ? (
            <TText muted style={{ marginTop: 10 }}>
              {t("common.loading")}
            </TText>
          ) : activity.length === 0 ? null : (
            <View style={{ marginTop: theme.spacing.sm }}>
              {activity.map((it) => (
                <Pressable key={it.rating_id} onPress={() => goVenue(it.venue_id)}>
                  <TCard style={{ marginBottom: theme.spacing.sm }}>
                    <View style={{ gap: 6 }}>
                      {venueById[it.venue_id]?.name ? <TText weight="800">{venueById[it.venue_id]?.name}</TText> : null}
                      {venueById[it.venue_id]?.city || venueById[it.venue_id]?.address_text ? (
                        <TText muted>
                          {[venueById[it.venue_id]?.city, venueById[it.venue_id]?.address_text].filter(Boolean).join(" · ")}
                        </TText>
                      ) : null}

                      {it.overall_score != null ? (
                        <TText weight="800">
                          {t("venue.scoreTitle")}: {Number(it.overall_score).toFixed(1)}
                        </TText>
                      ) : null}

                      {it.price_eur != null ? (
                        <TText muted>{t("venue.priceLine", { price: Number(it.price_eur).toFixed(2) })}</TText>
                      ) : null}

                      {it.comment ? <TText>{it.comment}</TText> : null}

                      <TText muted>{fmtDate(it.created_at)}</TText>

                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <TText muted>{kudosCountByRatingId[it.rating_id] ?? 0}</TText>
                        {session?.user?.id ? (
                          <Pressable
                            onPress={() => void toggleKudos(it.rating_id)}
                            disabled={!!kudosLoadingByRatingId[it.rating_id]}
                            style={{ opacity: kudosLoadingByRatingId[it.rating_id] ? 0.5 : 1 }}
                          >
                            <TText size={theme.font.h2} weight="700">
                              {myKudosSet.has(it.rating_id) ? "♥" : "♡"}
                            </TText>
                          </Pressable>
                        ) : null}
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


