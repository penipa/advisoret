import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  TextInput,
  Pressable,
  Image,
  Keyboard,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { supabase, venueCoverUrl } from "../lib/supabase";
import { theme } from "../theme";
import { TText } from "../ui/TText";
import { TCard } from "../ui/TCard";
import { useTranslation } from "react-i18next";

type AwardMode = "all" | "awarded" | "not_awarded";

type VenueRow = {
  id: string;
  name: string;
  city: string;
  address_text: string | null;
  cover_photo_path: string | null;
  has_cacau_dor?: boolean | null;
  cacau_badge_text?: string | null;
  cacau_badge_subtext?: string | null;
};

function Chip({
  label,
  active,
  onPress,
  rightIcon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  rightIcon?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,

          // ✅ mismo "lenguaje" que los ghost buttons
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: 1,

          // ✅ activo = oro suave (sin gritar)
          borderColor: active ? "rgba(201,163,92,0.35)" : theme.colors.border,
          backgroundColor: active ? "rgba(201,163,92,0.12)" : "transparent",

          marginRight: 8,
          marginBottom: 8,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <TText
        size={12}
        weight="800"
        style={{
          color: active ? theme.colors.gold : theme.colors.text,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </TText>

      {rightIcon ? <View style={{ marginLeft: 2 }}>{rightIcon}</View> : null}
    </Pressable>
  );
}


function VenueThumb({
  name,
  coverPath,
  cacheBust,
  size = 52,
}: {
  name: string;
  coverPath?: string | null;
  cacheBust: number;
  size?: number;
}) {
  const url = venueCoverUrl(coverPath ?? null, cacheBust);

  const initials = useMemo(() => {
    const s = (name ?? "").trim();
    if (!s) return "A";
    const parts = s.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "A";
    const b = parts.length > 1 ? parts[1]?.[0] ?? "" : "";
    return (a + b).toUpperCase();
  }, [name]);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      ) : (
        <TText weight="800" size={16} style={{ letterSpacing: 0.5 }}>
          {initials}
        </TText>
      )}
    </View>
  );
}

function formatCity(cityRaw?: string | null) {
  const s = (cityRaw ?? "").trim();
  const m = s.match(/^(.+?)\s*\((.+?)\)\s*$/);
  if (!m) return s;
  const city = (m[1] ?? "").trim();
  const area = (m[2] ?? "").trim();
  return area ? `${city} · ${area}` : city;
}

const PAGE_SIZE = 25;

export default function ExploreScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; city?: string; award?: string }>();

  const [q, setQ] = useState<string>((params.q ?? "").toString());
  const [selectedCity, setSelectedCity] = useState<string | null>(
    params.city ? String(params.city) : null
  );
  const [awardMode, setAwardMode] = useState<AwardMode>(() => {
    const a = (params.award ?? "").toString();
    if (a === "awarded") return "awarded";
    if (a === "not_awarded") return "not_awarded";
    return "all";
  });

  const [cities, setCities] = useState<string[]>([]);
  const [rows, setRows] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(true);

  const [coverBust, setCoverBust] = useState<number>(() => Date.now());

  const offsetRef = useRef<number>(0);
  const lastQueryKeyRef = useRef<string>("");

  const queryKey = useMemo(() => {
    return JSON.stringify({
      q: q.trim(),
      city: selectedCity ?? "",
      award: awardMode,
    });
  }, [q, selectedCity, awardMode]);

  const loadCities = useCallback(async () => {
    const res = await supabase.from("venues").select("city").limit(1200);
    if (res.error) return;

    const uniq = new Set<string>();
    for (const r of (res.data ?? []) as any[]) {
      const c = (r.city ?? "").trim();
      if (c) uniq.add(c);
    }

    const arr = Array.from(uniq.values()).sort((a, b) =>
      formatCity(a).localeCompare(formatCity(b), "es")
    );
    setCities(arr);
  }, []);

  const buildRequest = useCallback(
    (rangeFrom: number, rangeTo: number) => {
      let req = supabase
        .from("vw_venues_with_cacau")
        .select(
          "id,name,city,address_text,cover_photo_path,has_cacau_dor,cacau_badge_text,cacau_badge_subtext,status"
        )
        .eq("status", "active")
        .order("name", { ascending: true })
        .range(rangeFrom, rangeTo);

      if (selectedCity) req = req.ilike("city", `${selectedCity}%`);

      if (awardMode === "awarded") req = req.eq("has_cacau_dor", true);
      if (awardMode === "not_awarded") req = req.or("has_cacau_dor.is.null,has_cacau_dor.eq.false");

      const query = q.trim();
      if (query) {
        const esc = query.replace(/,/g, " ").trim();
        req = req.or(`name.ilike.%${esc}%,city.ilike.%${esc}%,address_text.ilike.%${esc}%`);
      }

      return req;
    },
    [awardMode, q, selectedCity]
  );

  const fetchPage = useCallback(
    async (reset: boolean) => {
      const sameQuery = lastQueryKeyRef.current === queryKey;
      if (reset || !sameQuery) {
        offsetRef.current = 0;
        lastQueryKeyRef.current = queryKey;
        setHasMore(true);
      }

      const from = offsetRef.current;
      const to = from + PAGE_SIZE - 1;

      try {
        if (reset) {
          setLoading(true);
          setError(null);
        } else {
          setLoadingMore(true);
        }

        const req = buildRequest(from, to);
        const res = await req;

        let data = res.data as any[] | null;
        let err = res.error;

        if (err) {
          let req2 = supabase
            .from("venues")
            .select("id,name,city,address_text,cover_photo_path,status")
            .eq("status", "active")
            .order("name", { ascending: true })
            .range(from, to);

          if (selectedCity) req2 = req2.ilike("city", `${selectedCity}%`);

          const query = q.trim();
          if (query) {
            const esc = query.replace(/,/g, " ").trim();
            req2 = req2.or(`name.ilike.%${esc}%,city.ilike.%${esc}%,address_text.ilike.%${esc}%`);
          }

          const res2 = await req2;
          data = res2.data as any[] | null;
          err = res2.error;

          if (!err && (awardMode === "awarded" || awardMode === "not_awarded")) {
            const aw = await supabase
              .from("venue_awards")
              .select("venue_id")
              .eq("award_name", "Cacau d’Or")
              .limit(2000);

            if (!aw.error) {
              const awarded = new Set(((aw.data ?? []) as any[]).map((x) => x.venue_id));
              if (awardMode === "awarded") data = (data ?? []).filter((v) => awarded.has(v.id));
              if (awardMode === "not_awarded") data = (data ?? []).filter((v) => !awarded.has(v.id));
            }
          }
        }

        if (err) throw new Error(err.message);

        const page = (data ?? []).map((v: any) => ({
          id: v.id,
          name: v.name,
          city: v.city,
          address_text: v.address_text ?? null,
          cover_photo_path: v.cover_photo_path ?? null,
          has_cacau_dor: v.has_cacau_dor ?? null,
          cacau_badge_text: v.cacau_badge_text ?? null,
          cacau_badge_subtext: v.cacau_badge_subtext ?? null,
        })) as VenueRow[];

        if (reset) setRows(page);
        else setRows((prev) => [...prev, ...page]);

        if (page.length < PAGE_SIZE) setHasMore(false);
        else offsetRef.current += PAGE_SIZE;
      } catch (e: any) {
        setError(e?.message ?? String(e));
        if (reset) setRows([]);
        setHasMore(false);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [awardMode, buildRequest, queryKey]
  );

  useEffect(() => {
    const t = setTimeout(() => void fetchPage(true), 250);
    return () => clearTimeout(t);
  }, [fetchPage, queryKey]);

  useEffect(() => {
    void loadCities();
  }, [loadCities]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setCoverBust(Date.now());
    await fetchPage(true);
    setRefreshing(false);
  }, [fetchPage]);

  const onEndReached = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    await fetchPage(false);
  }, [fetchPage, hasMore, loading, loadingMore]);

  const clearSearch = useCallback(() => {
    setQ("");
    Keyboard.dismiss();
  }, []);

  const clearCity = useCallback(() => {
    setSelectedCity(null);
    Keyboard.dismiss();
  }, []);

  const clearAll = useCallback(() => {
    setSelectedCity(null);
    setAwardMode("all");
    setQ("");
    Keyboard.dismiss();
  }, []);

  const Header = (
    <View style={{ padding: theme.spacing.md, paddingBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable
          onPress={() => router.push('/')}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <TText weight="800" size={12} muted>
            {t("explore.back")}
          </TText>
        </Pressable>

        <TText size={theme.font.h2} weight="800" style={{ flex: 1 }}>
          {t("explore.title")}
        </TText>

        <Pressable
          onPress={clearAll}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <TText weight="800" size={12} muted>
            {t("explore.clear")}
          </TText>
        </Pressable>
      </View>

      <View
        style={{
          marginTop: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t("explore.searchPlaceholder")}
          placeholderTextColor={theme.colors.textMuted}
          style={{ color: theme.colors.text, fontSize: 16, flex: 1 }}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="never"
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
        />

        {q.trim().length > 0 ? (
          <Pressable
            onPress={clearSearch}
            hitSlop={10}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <TText weight="800" size={12}>
              ✕
            </TText>
          </Pressable>
        ) : null}
      </View>

      <View style={{ marginTop: 12 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Chip
            label={selectedCity ? `📍 ${formatCity(selectedCity)}` : t("explore.cityChip")}
            active={!!selectedCity}
            onPress={() => Keyboard.dismiss()}
            rightIcon={
              selectedCity ? (
                <Pressable
                  onPress={clearCity}
                  hitSlop={10}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "rgba(0,0,0,0.15)",
                    backgroundColor: "rgba(255,255,255,0.85)",
                  }}
                >
                  <TText size={12} weight="800">
                    ×
                  </TText>
                </Pressable>
              ) : null
            }
          />
          <Chip
            label={t("explore.awarded")}
            active={awardMode === "awarded"}
            onPress={() => setAwardMode(awardMode === "awarded" ? "all" : "awarded")}
          />
          <Chip
            label={t("explore.withoutAward")}
            active={awardMode === "not_awarded"}
            onPress={() => setAwardMode(awardMode === "not_awarded" ? "all" : "not_awarded")}
          />
        </View>

        <FlatList
          data={cities}
          keyExtractor={(x) => x}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 2 }}
          renderItem={({ item }) => (
            <Chip
              label={formatCity(item)}
              active={selectedCity === item}
              onPress={() => {
                Keyboard.dismiss();
                setSelectedCity((prev) => (prev === item ? null : item));
              }}
            />
          )}
        />
      </View>

      {error ? (
        <TText style={{ color: theme.colors.danger, marginTop: 10 }}>
          {t("common.error")}: {error}
        </TText>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={Header}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 14 }}>
              <ActivityIndicator />
            </View>
          ) : !loading && rows.length === 0 ? (
            <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: 6 }}>
              <TText muted>{t("explore.noResults")}</TText>
            </View>
          ) : !hasMore ? (
            <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: 10 }}>
              <TText muted size={12}>
                {t("explore.endResults")}
              </TText>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/venue/[id]", params: { id: item.id } })}
            style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}
          >
            <TCard>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <VenueThumb name={item.name} coverPath={item.cover_photo_path} cacheBust={coverBust} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <TText weight="800" numberOfLines={1} style={{ flex: 1 }}>
                      {item.name}
                    </TText>

                    {item.cacau_badge_text ? (
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: "rgba(201,163,92,0.25)",
                          backgroundColor: "rgba(201,163,92,0.08)",
                        }}
                      >
                        <TText size={12} weight="800" caps style={{ color: theme.colors.gold }}>
                          {item.cacau_badge_text}
                        </TText>
                      </View>
                    ) : null}
                  </View>

                  <TText muted style={{ marginTop: 6 }} numberOfLines={2}>
                    {formatCity(item.city)}
                    {item.address_text ? ` · ${item.address_text}` : ""}
                  </TText>

                  {item.cacau_badge_subtext ? (
                    <TText
                      muted
                      size={12}
                      style={{ marginTop: 6 }}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.cacau_badge_subtext}
                    </TText>
                  ) : null}
                </View>
              </View>
            </TCard>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
