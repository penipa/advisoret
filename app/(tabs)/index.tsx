// <SECTION:IMPORTS>
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Pressable,
  TextInput,
  Image,
  Alert,
  Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";

import { supabase, venueCoverUrl } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TText } from "../../src/ui/TText";
import { BrandLockup } from "../../src/ui/BrandLockup";
import { TCard, TSkeletonBox, TSkeletonLine } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";
import { RatingRing } from "../../src/ui/RatingRing";
// </SECTION:IMPORTS>

// <SECTION:ASSETS>
const BRAND_A = require("../../assets/branding/logo-a.png");
// </SECTION:ASSETS>

// <SECTION:TYPES>
type MonthRow = {
  venue_id: string;
  name: string;
  city: string;

  // ✅ Métrica del mes (solo para ordenar / contexto)
  score_month: number;
  ratings_count_month: number;

  // ✅ Puntuación "de cara al usuario" (media real histórica)
  avg_score: number;
  ratings_count: number;
};

type AllTimeRow = {
  venue_id: string;
  name: string;
  city: string;

  // ✅ Puntuación "de cara al usuario" (media real)
  avg_score: number;
  ratings_count: number;

  // (solo para ordenar internamente)
  bayes_score?: number;
};

type ExploreVenue = {
  id: string;
  name: string;
  city: string;
  address_text?: string | null;
  cover_photo_path?: string | null;
};

type NewVenue = {
  id: string;
  name: string;
  city: string;
  address_text: string | null;
  cover_photo_path: string | null;
  created_at?: string | null;
  avg_score?: number | null;
  ratings_count?: number | null;
};

type NearVenue = {
  id: string;
  name: string;
  city: string;
  address_text: string | null;
  cover_photo_path: string | null;
  lat: number | null;
  lon: number | null;
  // calculados localmente
  distance_km: number;
  avg_score?: number | null;
  ratings_count?: number | null;
};

type ChipKey = "all" | "city" | "following" | "mine";
type AwardFilter = "all" | "awarded" | "no_award";
// </SECTION:TYPES>

// <SECTION:HELPERS_TEXT_FORMAT>
function reviewsLabel(n: number) {
  if (!n || n <= 0) return "Sin reseñas";
  if (n === 1) return "1 reseña";
  return String(n) + " reseñas";
}

function fmtKm(km: number) {
  if (!isFinite(km)) return "";
  if (km < 1) return String(Math.round(km * 1000)) + " m";
  if (km < 10) return km.toFixed(1) + " km";
  return String(Math.round(km)) + " km";
}
// </SECTION:HELPERS_TEXT_FORMAT>

// <SECTION:HELPERS_TIME>
// Mes natural en UTC (alineado con tu lógica mensual)
function monthRangeISO() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}
// </SECTION:HELPERS_TIME>

// <SECTION:UI_COMPONENTS>
function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? "transparent" : theme.colors.border,
        backgroundColor: active ? theme.colors.primary : "transparent",
        marginRight: 8,
        marginBottom: 8,
      }}
    >
      <TText size={12} weight="800" style={{ color: active ? "#062014" : theme.colors.text }}>
        {label}
      </TText>
    </Pressable>
  );
}

function RankCard({
  title,
  subtitle,
  score,
  n,
  badge,
}: {
  title: string;
  subtitle: string;
  score: number;
  n: number;
  badge?: string;
}) {
  return (
    <TCard style={{ width: 240, marginRight: theme.spacing.sm }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: 40,
        }}
      >
        <TText weight="800" size={16} numberOfLines={1} style={{ flex: 1, paddingRight: 10 }}>
          {title}
        </TText>

        {badge ? (
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
              {badge}
            </TText>
          </View>
        ) : null}
      </View>

      <TText muted size={theme.font.small} style={{ marginTop: 6 }} numberOfLines={1}>
        {subtitle}
      </TText>

      <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center" }}>
        <RatingRing
          value={Number(score ?? 0)}
          max={5}
          size={44}
          strokeWidth={5}
          showValue={true}
          valueDecimals={1}
          valueColor="#C9A35C"
        />

        <View style={{ marginLeft: 10, flex: 1 }}>
          <TText muted>{reviewsLabel(Number(n ?? 0))}</TText>
        </View>
      </View>
    </TCard>
  );
}

function SkeletonRankCard() {
  return (
    <TCard style={{ width: 240, marginRight: theme.spacing.sm }}>
      <TSkeletonLine width="70%" height={16} />
      <View style={{ height: 8 }} />
      <TSkeletonLine width="40%" height={12} />
      <View style={{ height: 14 }} />
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <TSkeletonBox width={44} height={44} radius={999} style={{ borderWidth: 0 }} />
        <View style={{ width: 10 }} />
        <TSkeletonLine width="55%" height={12} />
      </View>
    </TCard>
  );
}

function SkeletonWideCard() {
  return (
    <TCard style={{ width: 280, marginRight: theme.spacing.sm, padding: 0, overflow: "hidden" }}>
      <TSkeletonBox height={140} radius={0} style={{ borderWidth: 0 }} />
      <View style={{ padding: theme.spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            minHeight: 36,
          }}
        >
          <TSkeletonLine width="65%" height={16} />
          <TSkeletonBox width={36} height={36} radius={999} style={{ borderWidth: 0 }} />
        </View>
        <View style={{ height: 10 }} />
        <TSkeletonLine width="80%" height={12} />
        <View style={{ height: 10 }} />
        <TSkeletonLine width="45%" height={12} />
      </View>
    </TCard>
  );
}

function SkeletonExploreRow() {
  return (
    <TCard style={{ marginBottom: theme.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <TSkeletonBox width={52} height={52} radius={14} style={{ borderWidth: 0 }} />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <TSkeletonLine width="60%" height={14} />
          <View style={{ height: 8 }} />
          <TSkeletonLine width="85%" height={12} />
        </View>
      </View>
    </TCard>
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
        <View style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
          <TText weight="800" size={16} style={{ letterSpacing: 0.5 }}>
            {initials}
          </TText>
        </View>
      )}
    </View>
  );
}

function NewVenueCard({
  v,
  cacheBust,
  onPress,
}: {
  v: NewVenue;
  cacheBust: number;
  onPress: () => void;
}) {
  const url = venueCoverUrl(v.cover_photo_path ?? null, cacheBust);
  const score = Number(v.avg_score ?? 0);
  const n = Number(v.ratings_count ?? 0);

  return (
    <Pressable onPress={onPress}>
      <TCard style={{ width: 280, marginRight: theme.spacing.sm, padding: 0, overflow: "hidden" }}>
        {url ? (
          <Image source={{ uri: url }} style={{ width: "100%", height: 140 }} resizeMode="cover" />
        ) : (
          <View
            style={{
              width: "100%",
              height: 140,
              backgroundColor: theme.colors.surface2,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <VenueThumb name={v.name} coverPath={null} cacheBust={cacheBust} size={64} />
          </View>
        )}

        <View style={{ padding: theme.spacing.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 36 }}>
            <TText weight="800" numberOfLines={1} style={{ flex: 1, paddingRight: 10 }}>
              {v.name}
            </TText>

            {n > 0 ? (
              <RatingRing
                value={score}
                max={5}
                size={36}
                strokeWidth={4}
                showValue={true}
                valueDecimals={1}
                valueColor="#C9A35C"
              />
            ) : (
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  minWidth: 62,
                  alignItems: "center",
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <TText size={12} weight="800" style={{ color: theme.colors.text }}>
                  NUEVO
                </TText>
              </View>
            )}
          </View>

          <TText muted style={{ marginTop: 6 }} numberOfLines={2}>
            {v.city}
            {v.address_text ? " · " + v.address_text : ""}
          </TText>

          <TText muted style={{ marginTop: 10 }}>{reviewsLabel(n)}</TText>
          <TText
            muted
            size={12}
            style={{
              marginTop: 6,
              opacity: n <= 0 ? 1 : 0, // ✅ reserva espacio: altura constante en el carrusel
            }}
            numberOfLines={1}
          >
            Sé el primero en valorar
          </TText>
        </View>
      </TCard>
    </Pressable>
  );
}

function NearVenueCard({
  v,
  cacheBust,
  onPress,
}: {
  v: NearVenue;
  cacheBust: number;
  onPress: () => void;
}) {
  const url = venueCoverUrl(v.cover_photo_path ?? null, cacheBust);
  const score = Number(v.avg_score ?? 0);
  const n = Number(v.ratings_count ?? 0);

  return (
    <Pressable onPress={onPress}>
      <TCard style={{ width: 280, marginRight: theme.spacing.sm, padding: 0, overflow: "hidden" }}>
        {url ? (
          <Image source={{ uri: url }} style={{ width: "100%", height: 140 }} resizeMode="cover" />
        ) : (
          <View
            style={{
              width: "100%",
              height: 140,
              backgroundColor: theme.colors.surface2,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <VenueThumb name={v.name} coverPath={null} cacheBust={cacheBust} size={64} />
          </View>
        )}

        <View style={{ padding: theme.spacing.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 36 }}>
            <TText weight="800" numberOfLines={1} style={{ flex: 1, paddingRight: 10 }}>
              {v.name}
            </TText>

            {n > 0 ? (
              <RatingRing
                value={score}
                max={5}
                size={36}
                strokeWidth={4}
                showValue={true}
                valueDecimals={1}
                valueColor="#C9A35C"
              />
            ) : (
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  minWidth: 62,
                  alignItems: "center",
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <TText size={12} weight="800" style={{ color: theme.colors.text }}>
                  NUEVO
                </TText>
              </View>
            )}
          </View>

          <TText muted style={{ marginTop: 6 }} numberOfLines={2}>
            {fmtKm(v.distance_km) + " · " + v.city}
            {v.address_text ? " · " + v.address_text : ""}
          </TText>

          <TText muted style={{ marginTop: 10 }}>{reviewsLabel(n)}</TText>
          <TText
            muted
            size={12}
            style={{
              marginTop: 6,
              opacity: n <= 0 ? 1 : 0, // ✅ reserva espacio: altura constante en el carrusel
            }}
            numberOfLines={1}
          >
            Sé el primero en valorar
          </TText>
        </View>
      </TCard>
    </Pressable>
  );
}
// </SECTION:UI_COMPONENTS>

// <SECTION:HELPERS_GEO>
// Haversine (distancia en km)
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
// </SECTION:HELPERS_GEO>

// <SECTION:SCREEN>
export default function HomeScreen() {
  // <SECTION:SCREEN_INIT>
  const router = useRouter();

  // Home es escaparate: la búsqueda vive en la pestaña "Explorar"
  const SHOW_HOME_EXPLORE_ENTRY = false;
  // </SECTION:SCREEN_INIT>

  // <SECTION:STATE_RANKINGS>
  const [monthRows, setMonthRows] = useState<MonthRow[]>([]);
  const [allRows, setAllRows] = useState<AllTimeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rankLoading, setRankLoading] = useState(false);
  // </SECTION:STATE_RANKINGS>

  // <SECTION:STATE_EXPLORE>
  // Explorar
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<ChipKey>("all");
  const [cities, setCities] = useState<string[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  const [awardFilter, setAwardFilter] = useState<AwardFilter>("all");
  const [exploreRows, setExploreRows] = useState<ExploreVenue[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  // </SECTION:STATE_EXPLORE>

  // <SECTION:STATE_PREMIUM_CONTENT>
  // Premium default content
  const [newRows, setNewRows] = useState<NewVenue[]>([]);
  const [newLoading, setNewLoading] = useState(false);

  const [nearRows, setNearRows] = useState<NearVenue[]>([]);
  const [nearLoading, setNearLoading] = useState(false);
  const [locDenied, setLocDenied] = useState(false);
  // </SECTION:STATE_PREMIUM_CONTENT>

  // <SECTION:STATE_UI_MISC>
  // bust para imágenes (anti-cache)
  const [coverBust, setCoverBust] = useState<number>(0);
  // </SECTION:STATE_UI_MISC>

  // <SECTION:NAV_HELPERS>
  const goVenue = (venueId: string) => {
    router.push({ pathname: "/venue/[id]", params: { id: venueId } });
  };

  // Navegar a la pestaña "Explorar" (listado infinito) con filtros actuales
  const goExplore = useCallback(() => {
    const params: any = {};
    const qq = q.trim();
    if (qq) params.q = qq;
    if (selectedCity) params.city = selectedCity;
    if (awardFilter === "awarded") params.award = "awarded";
    if (awardFilter === "no_award") params.award = "not_awarded";

    Keyboard.dismiss();
    router.push({ pathname: "/explore", params });
  }, [router, q, selectedCity, awardFilter]);
  // </SECTION:NAV_HELPERS>

  // <SECTION:LOADERS_RANKINGS>
  const loadAllTime = async () => {
    // Ordenamos con bayes_score (estable con pocas reseñas),
    // pero mostramos avg_score (media real) para evitar incongruencias tipo “tengo 1 reseña y sale otro número”.
    const all = await supabase
      .from("vw_venue_stats_all_time")
      .select("venue_id,name,city,bayes_score,avg_score,ratings_count")
      .order("bayes_score", { ascending: false })
      .limit(5);

    if (all.error) throw new Error(all.error.message);
    setAllRows((all.data ?? []) as unknown as AllTimeRow[]);
  };

  async function loadMonthNatural() {
    const { startISO, endISO } = monthRangeISO();

    // 1) Ratings del mes (solo para ordenar el “top del mes”)
    const r = await supabase
      .from("vw_rating_overall")
      .select("venue_id,overall_score,created_at")
      .gte("created_at", startISO)
      .lt("created_at", endISO)
      .limit(500);

    if (r.error) throw new Error(r.error.message);

    const rows = (r.data ?? []) as Array<{ venue_id: string; overall_score: number }>;
    if (rows.length === 0) {
      setMonthRows([]);
      return;
    }

    // 2) Media simple del mes por venue_id
    const agg = new Map<string, { sum: number; n: number }>();
    for (const it of rows) {
      const vId = String(it.venue_id);
      const s = Number(it.overall_score ?? 0);
      const cur = agg.get(vId) ?? { sum: 0, n: 0 };
      cur.sum += s;
      cur.n += 1;
      agg.set(vId, cur);
    }

    const computed = Array.from(agg.entries()).map(([venue_id, a]) => ({
      venue_id,
      score_month: a.n > 0 ? a.sum / a.n : 0,
      ratings_count_month: a.n,
    }));

    computed.sort((a, b) => b.score_month - a.score_month);
    const top = computed.slice(0, 5);

    const ids = top.map((x) => x.venue_id);

    // 3) Metadatos + media histórica (lo que mostramos como “puntuación”)
    const g = await supabase
      .from("vw_venue_stats_all_time")
      .select("venue_id,name,city,avg_score,ratings_count")
      .in("venue_id", ids);

    if (g.error) throw new Error(g.error.message);

    const info = new Map<string, { name: string; city: string; avg: number; n: number }>();
    for (const row of (g.data ?? []) as any[]) {
      info.set(String(row.venue_id), {
        name: String(row.name ?? "—"),
        city: String(row.city ?? ""),
        avg: Number(row.avg_score ?? 0),
        n: Number(row.ratings_count ?? 0),
      });
    }

    const finalRows: MonthRow[] = top.map((x) => {
      const i = info.get(x.venue_id);
      return {
        venue_id: x.venue_id,
        name: i?.name ?? "—",
        city: i?.city ?? "",
        score_month: x.score_month,
        ratings_count_month: x.ratings_count_month,
        avg_score: i?.avg ?? 0,
        ratings_count: i?.n ?? 0,
      };
    });

    setMonthRows(finalRows);
  }

  const loadMe = async () => {
    const u = await supabase.auth.getUser();
    setMeId(u.data.user?.id ?? null);
  };

  const loadCities = async () => {
    const res = await supabase.from("venues").select("city").limit(500);
    if (res.error) return;
    const uniq = new Set<string>();
    for (const r of (res.data ?? []) as any[]) {
      const c = (r.city ?? "").trim();
      if (c) uniq.add(c);
    }
    const arr = Array.from(uniq.values()).sort((a, b) => a.localeCompare(b, "es"));
    setCities(arr);
  };

  const loadRankings = async () => {
    setError(null);
    setRankLoading(true);
    try {
      await Promise.all([loadAllTime(), loadMonthNatural(), loadMe(), loadCities()]);
    } finally {
      setRankLoading(false);
    }
  };
  // </SECTION:LOADERS_RANKINGS>

  // <SECTION:LOADERS_NEW>
  const loadNew = async () => {
    setNewLoading(true);
    try {
      const res = await supabase
        .from("venues")
        .select("id,name,city,address_text,cover_photo_path,created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      if (res.error) throw new Error(res.error.message);

      const base = (res.data ?? []) as NewVenue[];
      if (base.length === 0) {
        setNewRows([]);
        return;
      }

      const ids = base.map((x) => x.id);
      const rr = await supabase
        .from("vw_venue_stats_all_time")
        .select("venue_id,avg_score,ratings_count")
        .in("venue_id", ids);

      const rankMap = new Map<string, { avg_score: number; ratings_count: number }>();
      if (!rr.error) {
        for (const row of (rr.data ?? []) as any[]) {
          rankMap.set(row.venue_id, {
            avg_score: Number(row.avg_score ?? 0),
            ratings_count: Number(row.ratings_count ?? 0),
          });
        }
      }

      const enriched = base.map((v) => {
        const r = rankMap.get(v.id);
        return {
          ...v,
          avg_score: r?.avg_score ?? 0,
          ratings_count: r?.ratings_count ?? 0,
        };
      });

      setNewRows(enriched);
    } catch {
      setNewRows([]);
    } finally {
      setNewLoading(false);
    }
  };
  // </SECTION:LOADERS_NEW>

  // <SECTION:LOADERS_NEAR>
  const requestAndLoadNear = async () => {
    setNearLoading(true);
    setLocDenied(false);

    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setLocDenied(true);
        setNearRows([]);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const myLat = pos.coords.latitude;
      const myLon = pos.coords.longitude;

      // Traemos un pool razonable y ordenamos local (plan free friendly)
      const res = await supabase
        .from("vw_venues_with_coords")
        .select("id,name,city,address_text,cover_photo_path,lat,lon,created_at")
        .limit(200);

      if (res.error) throw new Error(res.error.message);

      const base = (res.data ?? []) as Array<{
        id: string;
        name: string;
        city: string;
        address_text: string | null;
        cover_photo_path: string | null;
        lat: number | null;
        lon: number | null;
      }>;

      const withDist: NearVenue[] = base
        .filter((v) => typeof v.lat === "number" && typeof v.lon === "number")
        .map((v) => ({
          ...v,
          distance_km: haversineKm(myLat, myLon, Number(v.lat), Number(v.lon)),
          avg_score: 0,
          ratings_count: 0,
        }))
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, 10);

      if (withDist.length === 0) {
        setNearRows([]);
        return;
      }

      // Enriquecer rating (all-time)
      const ids = withDist.map((x) => x.id);
      const rr = await supabase
        .from("vw_venue_stats_all_time")
        .select("venue_id,avg_score,ratings_count")
        .in("venue_id", ids);

      const rankMap = new Map<string, { avg_score: number; ratings_count: number }>();
      if (!rr.error) {
        for (const row of (rr.data ?? []) as any[]) {
          rankMap.set(row.venue_id, {
            avg_score: Number(row.avg_score ?? 0),
            ratings_count: Number(row.ratings_count ?? 0),
          });
        }
      }

      const enriched = withDist.map((v) => {
        const r = rankMap.get(v.id);
        return { ...v, avg_score: r?.avg_score ?? 0, ratings_count: r?.ratings_count ?? 0 };
      });

      setNearRows(enriched);
    } catch (e: any) {
      setNearRows([]);
      // No hacemos Alert siempre (molesta), pero en dev sí ayuda
      if (__DEV__) Alert.alert("Cerca de ti", e?.message ?? "No se pudo cargar la ubicación.");
    } finally {
      setNearLoading(false);
    }
  };
  // </SECTION:LOADERS_NEAR>

  // <SECTION:EXPLORE_LOGIC>
  const matchesQuery = useCallback((v: ExploreVenue, query: string) => {
    const qn = query.trim().toLowerCase();
    if (!qn) return true;
    const hay = (String(v.name ?? "") + " " + String(v.city ?? "") + " " + String(v.address_text ?? "")).toLowerCase();
    return hay.includes(qn);
  }, []);

  const shouldShowExplore = useMemo(() => {
    const hasQuery = q.trim().length > 0;
    const hasFilter = chip !== "all";
    return hasQuery || hasFilter;
  }, [q, chip]);

  const loadExplore = useCallback(async () => {
    if (!shouldShowExplore) {
      setExploreLoading(false);
      setExploreRows([]);
      return;
    }

    setExploreLoading(true);
    try {
      const query = q.trim();
      const wantCity = chip === "city";
      const wantMine = chip === "mine";
      const wantFollowing = chip === "following";

      // ✅ Premium: si estás en "Localidad" pero aún no has elegido ciudad, no devolvemos "Todo" por accidente.
      if (wantCity && !selectedCity && !query) {
        setExploreRows([]);
        return;
      }

      if ((wantMine || wantFollowing) && !meId) {
        setExploreRows([]);
        return;
      }

      if (!wantMine && !wantFollowing) {
        let req = supabase.from("venues").select("id,name,city,address_text,cover_photo_path").limit(50);

        if (wantCity && selectedCity) req = req.eq("city", selectedCity);

        if (query) {
          const esc = query.replace(/,/g, " ");
          req = req.or("name.ilike.%" + esc + "%,city.ilike.%" + esc + "%,address_text.ilike.%" + esc + "%");
        }

        const res = await req;
        if (res.error) throw new Error(res.error.message);
        setExploreRows((res.data ?? []) as ExploreVenue[]);
        return;
      }

      let userIds: string[] = [];
      if (wantMine && meId) userIds = [meId];

      if (wantFollowing && meId) {
        const f = await supabase.from("follows").select("following_id").eq("follower_id", meId);
        if (f.error) throw new Error(f.error.message);

        userIds = ((f.data ?? []) as any[]).map((x) => x.following_id).filter(Boolean);
        if (userIds.length === 0) {
          setExploreRows([]);
          return;
        }
      }

      const rr = await supabase
        .from("vw_rating_overall")
        .select("venue_id,created_at,user_id,overall_score")
        .in("user_id", userIds)
        .order("created_at", { ascending: false })
        .limit(250);

      if (rr.error) throw new Error(rr.error.message);

      const seen = new Set<string>();
      const venueIds: string[] = [];
      for (const row of (rr.data ?? []) as any[]) {
        const vid = row.venue_id as string;
        if (!vid) continue;
        if (seen.has(vid)) continue;
        seen.add(vid);
        venueIds.push(vid);
        if (venueIds.length >= 50) break;
      }

      if (venueIds.length === 0) {
        setExploreRows([]);
        return;
      }

      const vv = await supabase
        .from("venues")
        .select("id,name,city,address_text,cover_photo_path")
        .in("id", venueIds);

      if (vv.error) throw new Error(vv.error.message);

      const map = new Map<string, ExploreVenue>();
      for (const v of (vv.data ?? []) as any[]) map.set(v.id, v);

      const ordered = venueIds.map((id) => map.get(id)).filter(Boolean) as ExploreVenue[];

      let filtered = ordered;
      if (selectedCity) filtered = filtered.filter((x) => x.city === selectedCity);
      if (query) filtered = filtered.filter((x) => matchesQuery(x, query));

      setExploreRows(filtered);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setExploreRows([]);
    } finally {
      setExploreLoading(false);
    }
  }, [q, chip, selectedCity, meId, matchesQuery, shouldShowExplore]);

  useEffect(() => {
    const t = setTimeout(() => void loadExplore(), 250);
    return () => clearTimeout(t);
  }, [loadExplore]);

  const chipLabelCity = useMemo(() => {
    return selectedCity ? "📍 " + selectedCity : "📍 Localidad";
  }, [selectedCity]);
  // </SECTION:EXPLORE_LOGIC>

  // <SECTION:FOCUS_EFFECT>
  useFocusEffect(
    useCallback(() => {
      setCoverBust(Date.now());
      loadRankings().catch((e: any) => setError(e?.message ?? String(e)));
      void loadExplore();
      void loadNew();

      // ✅ solo intentamos “cerca de ti” cuando NO estás explorando
      if (!shouldShowExplore) {
        void requestAndLoadNear();
      }
    }, [loadExplore, shouldShowExplore])
  );
  // </SECTION:FOCUS_EFFECT>

  // <SECTION:RENDER>
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
        <BrandLockup
          title="Advisoret"
          subtitle="Esmorzarets"
          iconSource={BRAND_A}
          style={{ marginBottom: theme.spacing.lg + 6 }}
        />

        {error && (
          <TText style={{ color: theme.colors.danger, marginBottom: theme.spacing.md }}>
            Error: {error}
          </TText>
        )}

        {/* Rankings primero */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TText size={theme.font.h2} weight="700">
            Mejores del mes
          </TText>
          <TButton
            title="Ver todos"
            variant="ghost"
            style={{ paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" }}
            onPress={() => router.push("/rankings/month")}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
          {rankLoading && monthRows.length === 0 ? (
            <>
              <SkeletonRankCard />
              <SkeletonRankCard />
            </>
          ) : null}
          {monthRows.map((r) => (
            <Pressable key={r.venue_id} onPress={() => goVenue(r.venue_id)}>
              <RankCard
                title={r.name}
                subtitle={
                  (r.city ?? "") +
                  " · Mes " +
                  Number(r.score_month ?? 0).toFixed(1) +
                  " (" +
                  Number(r.ratings_count_month ?? 0) +
                  ")"
                }
                score={Number(r.avg_score ?? 0)}
                n={Number(r.ratings_count ?? 0)}
                badge="MES"
              />
            </Pressable>
          ))}
        </ScrollView>

        <View style={{ height: theme.spacing.lg + theme.spacing.sm }} />

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <TText size={theme.font.h2} weight="700">
            Mejores de siempre
          </TText>
          <TButton
            title="Ver todos"
            variant="ghost"
            style={{ paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" }}
            onPress={() => router.push("/rankings/all")}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
          {rankLoading && allRows.length === 0 ? (
            <>
              <SkeletonRankCard />
              <SkeletonRankCard />
            </>
          ) : null}
          {allRows.map((r) => (
            <Pressable key={r.venue_id} onPress={() => goVenue(r.venue_id)}>
              <RankCard title={r.name} subtitle={r.city} score={Number(r.avg_score ?? 0)} n={Number(r.ratings_count ?? 0)} />
            </Pressable>
          ))}
        </ScrollView>

        <View style={{ height: theme.spacing.lg + theme.spacing.sm }} />

        {/* Premium default content */}
        {!shouldShowExplore ? (
          <>
            {/* Cerca de ti */}
            <View style={{ marginBottom: theme.spacing.lg }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <TText size={theme.font.h2} weight="700">
                  Cerca de ti
                </TText>

                <TButton
                  title="Actualizar"
                  variant="ghost"
                  onPress={() => void requestAndLoadNear()}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" }}
                />
              </View>

              {nearLoading ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
                  <SkeletonWideCard />
                  <SkeletonWideCard />
                </ScrollView>
              ) : locDenied ? (
                <TText muted style={{ marginTop: 10 }}>
                  Activa la ubicación para ver los locales cercanos.
                </TText>
              ) : nearRows.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
                  {nearRows.map((v) => (
                    <NearVenueCard key={v.id} v={v} cacheBust={coverBust} onPress={() => goVenue(v.id)} />
                  ))}
                </ScrollView>
              ) : (
                <TText muted style={{ marginTop: 10 }}>No hay locales con coordenadas suficientes cerca (aún).</TText>
              )}
            </View>

            {/* Nuevos */}
            <View style={{ marginBottom: theme.spacing.lg }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <TText size={theme.font.h2} weight="700">
                  Nuevos
                </TText>
              </View>

              {newLoading ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
                  <SkeletonWideCard />
                  <SkeletonWideCard />
                </ScrollView>
              ) : newRows.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
                  {newRows.map((v) => (
                    <NewVenueCard key={v.id} v={v} cacheBust={coverBust} onPress={() => goVenue(v.id)} />
                  ))}
                </ScrollView>
              ) : (
                <TText muted style={{ marginTop: 10 }}>Aún no hay nuevos locales.</TText>
              )}
            </View>
          </>
        ) : null}

        {/* Explorar */}
        {SHOW_HOME_EXPLORE_ENTRY ? (
          <View style={{ marginBottom: theme.spacing.lg }}>
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Buscar local, ciudad o dirección…"
                placeholderTextColor={theme.colors.textMuted}
                style={{ color: theme.colors.text, fontSize: 16 }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={goExplore}
                blurOnSubmit={true}
                clearButtonMode="while-editing"
              />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 10 }}>
              <Chip label="Todo" active={chip === "all"} onPress={() => setChip("all")} />
              <Chip label={chipLabelCity} active={chip === "city"} onPress={() => setChip("city")} />
              <Chip label="Siguiendo" active={chip === "following"} onPress={() => setChip("following")} />
              <Chip label="Mis valoraciones" active={chip === "mine"} onPress={() => setChip("mine")} />
            </View>

            {chip === "city" && selectedCity ? (
              <TButton
                title="Quitar filtro"
                variant="ghost"
                onPress={() => {
                  setSelectedCity(null);
                  setChip("all");
                }}
                style={{ alignSelf: "flex-start", marginTop: 6, paddingHorizontal: 10, paddingVertical: 6 }}
              />
            ) : null}

            {chip === "city" && cities.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                {cities.slice(0, 20).map((c) => (
                  <Chip key={c} label={c} active={selectedCity === c} onPress={() => setSelectedCity(c)} />
                ))}
              </ScrollView>
            ) : null}

            {chip === "city" && !selectedCity ? (
              <TText muted style={{ marginTop: 8 }}>Elige una localidad para filtrar.</TText>
            ) : null}

            {exploreLoading ? (
              <View style={{ marginTop: 10 }}>
                <TSkeletonLine width="35%" height={12} />
              </View>
            ) : null}

            {exploreLoading && shouldShowExplore ? (
              <View style={{ marginTop: theme.spacing.sm }}>
                <SkeletonExploreRow />
                <SkeletonExploreRow />
              </View>
            ) : null}

            {!exploreLoading && shouldShowExplore && exploreRows.length > 0 ? (
              <View style={{ marginTop: theme.spacing.sm }}>
                {exploreRows.slice(0, 12).map((v) => (
                  <Pressable key={v.id} onPress={() => goVenue(v.id)}>
                    <TCard style={{ marginBottom: theme.spacing.sm }}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <VenueThumb name={v.name} coverPath={v.cover_photo_path} cacheBust={coverBust} />

                        <View style={{ marginLeft: 12, flex: 1 }}>
                          <TText weight="800" numberOfLines={1}>
                            {v.name}
                          </TText>
                          <TText muted style={{ marginTop: 6 }} numberOfLines={2}>
                            {v.city}
                            {v.address_text ? " · " + v.address_text : ""}
                          </TText>
                        </View>
                      </View>
                    </TCard>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!exploreLoading && shouldShowExplore && exploreRows.length === 0 ? (
              <TText muted style={{ marginTop: 10 }}>Sin resultados.</TText>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
  // </SECTION:RENDER>
}
// </SECTION:SCREEN>
