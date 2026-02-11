import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Pressable, Alert, ScrollView } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { supabase } from "../src/lib/supabase";
import { theme } from "../src/theme";
import { TText } from "../src/ui/TText";
import { TCard } from "../src/ui/TCard";

type FollowRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  followers_count?: number;
};

type SuggestedRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  active_days_30d: number | null;
  kudos_received_30d: number | null;
};

type ActiveTab = "following" | "followers";

export default function FollowsScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [me, setMe] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("following");
  const [followingRows, setFollowingRows] = useState<FollowRow[]>([]);
  const [followersRows, setFollowersRows] = useState<FollowRow[]>([]);
  const [followingLoading, setFollowingLoading] = useState(true);
  const [followersLoading, setFollowersLoading] = useState(true);
  const [suggested, setSuggested] = useState<SuggestedRow[]>([]);
  const [suggestedLoading, setSuggestedLoading] = useState(true);
  const [followLoadingByUserId, setFollowLoadingByUserId] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;

    (async () => {
      const s = await supabase.auth.getSession();
      const uid = s.data.session?.user?.id ?? null;
      if (!alive) return;

      setMe(uid);
      if (!uid) {
        setFollowingLoading(false);
        setFollowersLoading(false);
        return;
      }

      const [followingRes, followersRes] = await Promise.all([
        supabase
          .from("vw_following")
          .select("user_id, username, display_name, avatar_url, created_at, followers_count")
          .eq("viewer_id", uid)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("vw_followers")
          .select("user_id, username, display_name, avatar_url, created_at, followers_count")
          .eq("viewer_id", uid)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      if (!alive) return;

      if (followingRes.error) {
        Alert.alert(t("common.error"), followingRes.error.message ?? "");
        setFollowingRows([]);
      } else {
        setFollowingRows((followingRes.data ?? []) as FollowRow[]);
      }
      setFollowingLoading(false);

      if (followersRes.error) {
        Alert.alert(t("common.error"), followersRes.error.message ?? "");
        setFollowersRows([]);
      } else {
        setFollowersRows((followersRes.data ?? []) as FollowRow[]);
      }
      setFollowersLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [t]);

  const followingIdSet = useMemo(() => new Set(followingRows.map((row) => row.user_id)), [followingRows]);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!me) {
        setSuggested([]);
        setSuggestedLoading(false);
        return;
      }
      if (followingLoading) return;

      setSuggestedLoading(true);
      const suggestedRes = await supabase
        .from("vw_user_quality_30d")
        .select("user_id, username, display_name, avatar_url, active_days_30d, kudos_received_30d")
        .order("kudos_received_30d", { ascending: false })
        .order("active_days_30d", { ascending: false })
        .limit(20);

      if (!alive) return;

      if (suggestedRes.error) {
        Alert.alert(t("common.error"), suggestedRes.error.message ?? "");
        setSuggested([]);
        setSuggestedLoading(false);
        return;
      }

      const filtered = ((suggestedRes.data ?? []) as SuggestedRow[])
        .filter((row) => row.user_id !== me && !followingIdSet.has(row.user_id))
        .filter((row) => {
          const display = (row.display_name ?? "").trim();
          const username = (row.username ?? "").trim();
          return !!display || !!username;
        })
        .slice(0, 8);

      setSuggested(filtered);
      setSuggestedLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [followingIdSet, followingLoading, me, t]);

  const rows = useMemo(
    () => (activeTab === "following" ? followingRows : followersRows),
    [activeTab, followersRows, followingRows]
  );

  const loading = activeTab === "following" ? followingLoading : followersLoading;

  const openUser = (id: string) => {
    router.push({ pathname: "/user/[id]", params: { id } });
  };

  const followSuggested = async (row: SuggestedRow) => {
    if (!me) return;

    setFollowLoadingByUserId((prev) => ({ ...prev, [row.user_id]: true }));
    try {
      const ins = await supabase.from("user_follows").insert({ follower_id: me, followed_id: row.user_id });
      if (ins.error) throw new Error(ins.error.message);

      setSuggested((prev) => prev.filter((item) => item.user_id !== row.user_id));
      setFollowingRows((prev) => [
        {
          user_id: row.user_id,
          username: row.username,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
          created_at: new Date().toISOString(),
          followers_count: 0,
        },
        ...prev,
      ]);
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "");
    } finally {
      setFollowLoadingByUserId((prev) => ({ ...prev, [row.user_id]: false }));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ title: t("follows.title"), headerBackTitle: t("common.back") }} />

      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
        {suggested.length > 0 && !suggestedLoading ? (
          <TCard style={{ marginBottom: 10 }}>
            <View style={{ gap: 10 as any }}>
              {suggested.map((row) => {
                const label = (row.display_name ?? "").trim() || (row.username ? `@${row.username}` : "");
                return (
                  <View
                    key={`suggested-${row.user_id}`}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <Pressable onPress={() => openUser(row.user_id)} style={{ flex: 1, paddingRight: 12 }}>
                      <TText weight="700">{label}</TText>
                      {row.username ? <TText muted style={{ marginTop: 4 }}>{`@${row.username}`}</TText> : null}
                    </Pressable>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 as any }}>
                      <TText size={12} muted>{`♥ ${row.kudos_received_30d ?? 0}  ⏱ ${row.active_days_30d ?? 0}`}</TText>
                      <Pressable
                        onPress={() => void followSuggested(row)}
                        disabled={!!followLoadingByUserId[row.user_id]}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          opacity: followLoadingByUserId[row.user_id] ? 0.5 : 1,
                        }}
                      >
                        <TText weight="800">+</TText>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </TCard>
        ) : null}

        <View style={{ flexDirection: "row", gap: 10 as any }}>
          <Pressable
            onPress={() => setActiveTab("following")}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: "transparent",
              opacity: activeTab === "following" ? 1 : 0.55,
            }}
          >
            <TText weight="800" size={12} muted>
              {t("follows.following")}
            </TText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab("followers")}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: "transparent",
              opacity: activeTab === "followers" ? 1 : 0.55,
            }}
          >
            <TText weight="800" size={12} muted>
              {t("follows.followers")}
            </TText>
          </Pressable>
        </View>

        <TCard style={{ marginTop: 10 }}>
          {!me ? null : loading ? (
            <TText muted>{t("common.loading")}</TText>
          ) : rows.length === 0 ? (
            <TText muted>{activeTab === "following" ? t("follows.emptyFollowing") : t("follows.emptyFollowers")}</TText>
          ) : (
            <View style={{ gap: 10 as any }}>
              {rows.map((row) => {
                const label = (row.display_name ?? "").trim() || (row.username ? `@${row.username}` : "");
                const fallback = row.username ? `@${row.username}` : row.user_id;
                return (
                  <Pressable
                    key={`${activeTab}-${row.user_id}`}
                    onPress={() => openUser(row.user_id)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <TText weight="700">{label || fallback}</TText>
                      {row.username ? <TText muted style={{ marginTop: 4 }}>{`@${row.username}`}</TText> : null}
                    </View>
                    <TText size={12} muted>{row.followers_count ?? 0}</TText>
                  </Pressable>
                );
              })}
            </View>
          )}
        </TCard>
      </ScrollView>
    </SafeAreaView>
  );
}
