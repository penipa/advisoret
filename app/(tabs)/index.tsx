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
import { useTranslation } from "react-i18next";

import { supabase, venueCoverUrl } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TText } from "../../src/ui/TText";
import { BrandLockup } from "../../src/ui/BrandLockup";
import { TCard, TSkeletonBox, TSkeletonLine } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";
import { RatingRing } from "../../src/ui/RatingRing";
import i18n from "../../src/i18n";
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

  featured_label?: string | null;
  label?: string | null;
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

type ActivityRow = {
  rating_id: string;
  venue_id: string;
  user_id: string;
  created_at: string;
  price_eur: number | null;
  comment: string | null;
  overall_score: number | null;
  product_type_id: string | null;
};
// </SECTION:TYPES>

// <SECTION:HELPERS_TEXT_FORMAT>
function reviewsLabel(n: number) {
  if (!n || n <= 0) return i18n.t("home.reviews.none");
  if (n === 1) return i18n.t("home.reviews.one");
  return i18n.t("home.reviews.many", { count: n });
}

function fmtKm(km: number) {
  if (!isFinite(km)) return "";
  if (km < 1) return String(Math.round(km * 1000)) + " " + i18n.t("home.units.m");
  if (km < 10) return km.toFixed(1) + " " + i18n.t("home.units.km");
  return String(Math.round(km)) + " " + i18n.t("home.units.km");
}

function fmtFeedDate(iso: string, lang: string) {
  try {
    return new Date(iso).toLocaleDateString(lang || undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
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
        backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
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
  badgeText,
}: {
  v: NewVenue;
  cacheBust: number;
  onPress: () => void;
  badgeText?: string | null;
}) {
  const url = venueCoverUrl(v.cover_photo_path ?? null, cacheBust);
  const score = Number(v.avg_score ?? 0);
  const n = Number(v.ratings_count ?? 0);
  const showBadge = typeof badgeText === "string" && badgeText.trim().length > 0;
  const badge = showBadge ? badgeText!.trim() : "";

  const Pill = ({ text }: { text: string }) => (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        minWidth: 62,
        alignItems: "center",
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "rgba(201,163,92,0.25)",
        backgroundColor: "rgba(201,163,92,0.08)",
      }}
    >
      <TText size={12} weight="800" caps style={{ color: theme.colors.gold }}>
        {text}
      </TText>
    </View>
  );

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
              backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
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
            ) : showBadge ? (
              <Pill text={badge} />
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
                  backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
                }}
              >
                <TText size={12} weight="800" style={{ color: theme.colors.text }}>
                  {i18n.t("common.new")}
                </TText>
              </View>
            )}
          </View>

          <View
            style={{
              marginTop: 6,
              minHeight: 26, // ✅ reserva 1 línea de pill SIEMPRE (evita saltos de altura)
              alignSelf: "flex-start",
              opacity: showBadge && n > 0 ? 1 : 0, // ✅ ocupa espacio aunque no se vea
            }}
          >
            <Pill text={badge} />
          </View>

          <TText
            muted
            numberOfLines={2}
            style={{
              marginTop: 6,
              lineHeight: 18,
              minHeight: 18 * 2, // ✅ reserva siempre 2 líneas
            }}
          >
            {v.city}
            {v.address_text ? " · " + v.address_text : ""}
          </TText>

          <TText muted style={{ marginTop: 10 }}>
            {reviewsLabel(n)}
          </TText>

          <TText
            muted
            size={12}
            style={{
              marginTop: 6,
              opacity: n <= 0 ? 1 : 0, // ✅ reserva espacio
            }}
            numberOfLines={1}
          >
            {i18n.t("home.beFirstToRate")}
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
              backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
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
                  backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
                }}
              >
                <TText size={12} weight="800" style={{ color: theme.colors.text }}>
                  {i18n.t("common.new")}
                </TText>
              </View>
            )}
          </View>

          <TText
            muted
            numberOfLines={2}
            style={{
              marginTop: 6,
              lineHeight: 18,
              minHeight: 18 * 2, // ✅ reserva siempre 2 líneas
            }}
          >
            {fmtKm(v.distance_km) + " · " + v.city}
            {v.address_text ? " · " + v.address_text : ""}
          </TText>

          <TText muted style={{ marginTop: 10 }}>
            {reviewsLabel(n)}
          </TText>
          <TText
            muted
            size={12}
            style={{
              marginTop: 6,
              opacity: n <= 0 ? 1 : 0,
            }}
            numberOfLines={1}
          >
            {i18n.t("home.beFirstToRate")}
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
const { t } = useTranslation();

// Home es escaparate: la búsqueda vive en la pestaña "Explorar"
const SHOW_HOME_EXPLORE_ENTRY = false;

// ✅ Product type “Esmorzaret” (fijo)
const ESMORZARET_PRODUCT_TYPE_ID = "5b0af5a5-e73a-4381-9796-c6676c285206";
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

  // <SECTION:STATE_FEED>
  const [followingFeed, setFollowingFeed] = useState<ActivityRow[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [profilesById, setProfilesById] = useState<
    Record<string, { username?: string; display_name?: string; avatar_url?: string }>
  >({});
  const [venuesById, setVenuesById] = useState<
    Record<string, { name?: string; city?: string; address_text?: string }>
  >({});
  const [kudosCountByRatingId, setKudosCountByRatingId] = useState<Record<string, number>>({});
  const [myKudosSet, setMyKudosSet] = useState<Set<string>>(new Set());
  const [kudosLoadingByRatingId, setKudosLoadingByRatingId] = useState<Record<string, boolean>>({});
  // </SECTION:STATE_FEED>

// <SECTION:STATE_PREMIUM_CONTENT>
// Premium default content

// ✅ Destacados (editorial/patrocinado)
const [featuredRows, setFeaturedRows] = useState<NewVenue[]>([]);
const [featuredLoading, setFeaturedLoading] = useState(false);

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

  const goUser = (userId: string) => {
    router.push({ pathname: "/user/[id]", params: { id: userId } });
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
  // Orden estable con bayes_score, mostramos avg_score
  const all = await supabase
    .from("vw_venue_stats_all_time_current")
    .select("venue_id,name,city,bayes_score,avg_score,ratings_count")
    .order("bayes_score", { ascending: false })
    .limit(5);

  if (all.error) throw new Error(all.error.message);
  setAllRows((all.data ?? []) as unknown as AllTimeRow[]);
};

async function loadMonthNatural() {
  // ✅ “Mejor del mes pasado” (foto del mes anterior): viene de BD
  const r = await supabase
    .from("vw_venue_stats_prev_month")
    .select("venue_id,name,city,product_type_id,bayes_score,avg_score,ratings_count")
    .eq("product_type_id", ESMORZARET_PRODUCT_TYPE_ID)
    .order("bayes_score", { ascending: false })
    .limit(5);

  if (r.error) throw new Error(r.error.message);

  const rows = (r.data ?? []) as any[];

  const mapped: MonthRow[] = rows.map((x) => ({
    venue_id: String(x.venue_id),
    name: String(x.name ?? "—"),
    city: String(x.city ?? ""),
    score_month: Number(x.bayes_score ?? 0),
    ratings_count_month: Number(x.ratings_count ?? 0),
    avg_score: Number(x.avg_score ?? 0),
    ratings_count: Number(x.ratings_count ?? 0),
  }));

  setMonthRows(mapped);
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

  // <SECTION:LOADERS_FOLLOWING_FEED>
  const loadFollowingFeed = useCallback(async () => {
    if (!meId) {
      setFollowedIds([]);
      setFollowingFeed([]);
      setProfilesById({});
      setVenuesById({});
      setKudosCountByRatingId({});
      setMyKudosSet(new Set());
      setFeedLoading(false);
      return;
    }

    setFeedLoading(true);
    try {
      const followsRes = await supabase.from("user_follows").select("followed_id").eq("follower_id", meId);
      if (followsRes.error) throw new Error(followsRes.error.message);

      const ids = Array.from(
        new Set(
          ((followsRes.data ?? []) as Array<{ followed_id: string | null }>)
            .map((r) => r.followed_id ?? "")
            .filter(Boolean)
        )
      );
      setFollowedIds(ids);

      if (ids.length === 0) {
        setFollowingFeed([]);
        setProfilesById({});
        setVenuesById({});
        setKudosCountByRatingId({});
        setMyKudosSet(new Set());
        return;
      }

      const feedRes = await supabase
        .from("vw_rating_overall")
        .select("rating_id, venue_id, user_id, created_at, price_eur, comment, overall_score, product_type_id")
        .in("user_id", ids)
        .order("created_at", { ascending: false })
        .limit(20);

      if (feedRes.error) throw new Error(feedRes.error.message);

      const rows = (feedRes.data ?? []) as ActivityRow[];
      setFollowingFeed(rows);

      const userIds = Array.from(new Set(rows.map((x) => x.user_id).filter(Boolean)));
      const venueIds = Array.from(new Set(rows.map((x) => x.venue_id).filter(Boolean)));
      const ratingIds = Array.from(new Set(rows.map((x) => x.rating_id).filter(Boolean)));

      if (userIds.length > 0) {
        const profilesRes = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", userIds);
        if (profilesRes.error) {
          Alert.alert(t("common.error"), profilesRes.error.message ?? "");
        } else {
          const map: Record<string, { username?: string; display_name?: string; avatar_url?: string }> = {};
          for (const p of (profilesRes.data ?? []) as Array<{
            id: string;
            username: string | null;
            display_name: string | null;
            avatar_url: string | null;
          }>) {
            map[p.id] = {
              username: p.username ?? undefined,
              display_name: p.display_name ?? undefined,
              avatar_url: p.avatar_url ?? undefined,
            };
          }
          setProfilesById(map);
        }
      } else {
        setProfilesById({});
      }

      if (venueIds.length > 0) {
        const venuesRes = await supabase.from("venues").select("id, name, city, address_text").in("id", venueIds);
        if (venuesRes.error) {
          Alert.alert(t("common.error"), venuesRes.error.message ?? "");
        } else {
          const map: Record<string, { name?: string; city?: string; address_text?: string }> = {};
          for (const v of (venuesRes.data ?? []) as Array<{
            id: string;
            name: string | null;
            city: string | null;
            address_text: string | null;
          }>) {
            map[v.id] = {
              name: v.name ?? undefined,
              city: v.city ?? undefined,
              address_text: v.address_text ?? undefined,
            };
          }
          setVenuesById(map);
        }
      } else {
        setVenuesById({});
      }

      if (ratingIds.length > 0) {
        const countsRes = await supabase.from("rating_kudos").select("rating_id").in("rating_id", ratingIds);
        if (countsRes.error) {
          Alert.alert(t("common.error"), countsRes.error.message ?? "");
        } else {
          const counts: Record<string, number> = {};
          for (const row of (countsRes.data ?? []) as Array<{ rating_id: string }>) {
            counts[row.rating_id] = (counts[row.rating_id] ?? 0) + 1;
          }
          setKudosCountByRatingId(counts);
        }

        const mineRes = await supabase
          .from("rating_kudos")
          .select("rating_id")
          .eq("user_id", meId)
          .in("rating_id", ratingIds);
        if (mineRes.error) {
          Alert.alert(t("common.error"), mineRes.error.message ?? "");
        } else {
          setMyKudosSet(new Set((mineRes.data ?? []).map((r) => r.rating_id)));
        }
      } else {
        setKudosCountByRatingId({});
        setMyKudosSet(new Set());
      }
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "");
      setFollowedIds([]);
      setFollowingFeed([]);
      setProfilesById({});
      setVenuesById({});
      setKudosCountByRatingId({});
      setMyKudosSet(new Set());
    } finally {
      setFeedLoading(false);
    }
  }, [meId, t]);

  const toggleKudos = async (ratingId: string) => {
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
  // </SECTION:LOADERS_FOLLOWING_FEED>


// <SECTION:LOADERS_FEATURED>
const loadFeatured = async () => {
  setFeaturedLoading(true);
  try {
    const fv = await supabase
      .from("featured_venues")
      .select("venue_id,priority,start_at,label,tag")
      .order("priority", { ascending: false })
      .order("start_at", { ascending: false })
      .limit(2);

    if (fv.error) throw new Error(fv.error.message);

    const featured = (fv.data ?? []) as any[];
    const ids = featured.map((x) => String(x.venue_id)).filter(Boolean);

    if (ids.length === 0) {
      setFeaturedRows([]);
      return;
    }

    const labelById = new Map<string, string | null>();
    const tagById = new Map<string, string | null>();
    for (const x of featured) {
      const id = String(x.venue_id);
      const label = typeof x.label === "string" ? x.label : null;
      const tag = typeof x.tag === "string" ? x.tag : null;
      if (id) labelById.set(id, label);
      if (id) tagById.set(id, tag);
    }

    const v = await supabase
      .from("venues")
      .select("id,name,city,address_text,cover_photo_path,created_at")
      .in("id", ids);

    if (v.error) throw new Error(v.error.message);

    const venueMap = new Map<string, any>();
    for (const row of (v.data ?? []) as any[]) {
      venueMap.set(String(row.id), row);
    }

    const rr = await supabase
      .from("vw_venue_stats_all_time_current")
      .select("venue_id,avg_score,ratings_count")
      .in("venue_id", ids);

    const statMap = new Map<string, { avg_score: number; ratings_count: number }>();
    if (!rr.error) {
      for (const row of (rr.data ?? []) as any[]) {
        statMap.set(String(row.venue_id), {
          avg_score: Number(row.avg_score ?? 0),
          ratings_count: Number(row.ratings_count ?? 0),
        });
      }
    }

    const finalRows: NewVenue[] = ids
      .map((id) => {
        const vv = venueMap.get(id);
        if (!vv) return null;

        const st = statMap.get(id);
        return {
          id: String(vv.id),
          name: String(vv.name ?? "—"),
          city: String(vv.city ?? ""),
          address_text: vv.address_text ?? null,
          cover_photo_path: vv.cover_photo_path ?? null,
          created_at: vv.created_at ?? null,
          avg_score: st?.avg_score ?? 0,
          ratings_count: st?.ratings_count ?? 0,
          featured_label: null,
          label: labelById.get(id) ?? null,
          tag: tagById.get(id) ?? null,
        } as NewVenue;
      })
      .filter(Boolean) as NewVenue[];

    setFeaturedRows(finalRows);
  } catch (e: any) {
    setFeaturedRows([]);
    setError(e?.message ?? String(e));
  } finally {
    setFeaturedLoading(false);
  }
};
// </SECTION:LOADERS_FEATURED>


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
      .from("vw_venue_stats_all_time_current")
      .select("venue_id,avg_score,ratings_count")
      .in("venue_id", ids);

    const rankMap = new Map<string, { avg_score: number; ratings_count: number }>();
    if (!rr.error) {
      for (const row of (rr.data ?? []) as any[]) {
        rankMap.set(String(row.venue_id), {
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
        .from("vw_venue_stats_all_time_current")
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
      if (__DEV__) Alert.alert(t("home.nearbyAlertTitle"), e?.message ?? t("home.nearbyLoadError"));
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
    return selectedCity ? "📍 " + selectedCity : t("home.chips.city");
  }, [selectedCity, t]);
  // </SECTION:EXPLORE_LOGIC>

  useEffect(() => {
    void loadFollowingFeed();
  }, [loadFollowingFeed]);

// <SECTION:FOCUS_EFFECT>
useFocusEffect(
  useCallback(() => {
    setCoverBust(Date.now());

    loadRankings().catch((e: any) => setError(e?.message ?? String(e)));
    void loadFollowingFeed();
    void loadExplore();
    void loadFeatured(); // ✅ destacados
    void loadNew();

    if (!shouldShowExplore) {
      void requestAndLoadNear();
    }
  }, [loadExplore, loadFollowingFeed, shouldShowExplore])
);
// </SECTION:FOCUS_EFFECT>

// <SECTION:RENDER>
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
    <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
      {/* <SECTION:HOME_HEADER> */}
      <BrandLockup
        title={t("home.brandTitle")}
        subtitle={t("home.brandSubtitle")}
        iconSource={BRAND_A}
        style={{ marginBottom: theme.spacing.md }}
      />

      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: theme.spacing.lg + 6 }}>
        <TButton
          title={t("home.proposeVenue")}
          variant="ghost"
          style={{ paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" }}
          onPress={() => router.push("/venue/suggest")}
        />
      </View>
      {/* </SECTION:HOME_HEADER> */}

      {error && (
        <TText style={{ color: theme.colors.danger, marginBottom: theme.spacing.md }}>
          {t("common.error")}: {error}
        </TText>
      )}

      {/* Premium default content */}
      {!shouldShowExplore ? (
        <>
          {/* Destacados (editorial / patrocinado) */}
          <View style={{ marginBottom: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText size={theme.font.h2} weight="700">
                {t("home.featured")}
              </TText>
            </View>

            {featuredLoading ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
                <SkeletonWideCard />
                <SkeletonWideCard />
              </ScrollView>
            ) : featuredRows.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
                {featuredRows.map((v) => (
                  <NewVenueCard
                    key={v.id}
                    v={v}
                    cacheBust={coverBust}
                    onPress={() => goVenue(v.id)}
                    badgeText={(() => {
                      const tag = typeof (v as any)?.tag === "string" ? (v as any).tag.trim().toLowerCase() : "";
                      const label = typeof (v as any)?.label === "string" ? (v as any).label.trim() : "";
                      if (tag === "recommended") return t("featured.tags.recommended");
                      if (tag !== "") return label || tag;
                      return label || null;
                    })()}
                  />
                ))}
              </ScrollView>
            ) : (
              <TText muted style={{ marginTop: 10 }}>
                {t("home.noFeaturedActive")}
              </TText>
            )}
          </View>

          {meId && (feedLoading || followedIds.length > 0) ? (
            <View style={{ marginBottom: theme.spacing.lg }}>
              {feedLoading ? (
                <TText muted style={{ marginTop: 10 }}>
                  {t("common.loading")}
                </TText>
              ) : followingFeed.length > 0 ? (
                <View style={{ marginTop: theme.spacing.sm }}>
                  {followingFeed.map((it) => {
                    const profile = profilesById[it.user_id];
                    const venue = venuesById[it.venue_id];
                    const author = (profile?.display_name ?? profile?.username ?? "").trim();
                    const venueLine = [venue?.name, venue?.city].filter(Boolean).join(" · ");
                    return (
                      <Pressable key={it.rating_id} onPress={() => goVenue(it.venue_id)}>
                        <TCard style={{ marginBottom: theme.spacing.sm }}>
                          <View style={{ gap: 6 }}>
                            <Pressable
                              onPress={() => goUser(it.user_id)}
                              style={{ alignSelf: "flex-start" }}
                              hitSlop={8}
                            >
                              <TText weight="800">{author}</TText>
                            </Pressable>

                            {venueLine ? <TText muted>{venueLine}</TText> : null}

                            {it.overall_score != null ? (
                              <TText weight="800">
                                {t("venue.scoreTitle")}: {Number(it.overall_score).toFixed(1)}
                              </TText>
                            ) : null}

                            {it.comment ? <TText>{it.comment}</TText> : null}

                            <TText muted>{fmtFeedDate(it.created_at, i18n.language)}</TText>

                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                              <TText muted>{kudosCountByRatingId[it.rating_id] ?? 0}</TText>
                              <Pressable
                                onPress={() => void toggleKudos(it.rating_id)}
                                disabled={!!kudosLoadingByRatingId[it.rating_id]}
                                style={{ opacity: kudosLoadingByRatingId[it.rating_id] ? 0.5 : 1 }}
                              >
                                <TText size={theme.font.h2} weight="700">
                                  {myKudosSet.has(it.rating_id) ? "♥" : "♡"}
                                </TText>
                              </Pressable>
                            </View>
                          </View>
                        </TCard>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Rankings */}
          {monthRows.length >= 2 ? (
            <>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <TText size={theme.font.h2} weight="700">
                  {t("home.bestLastMonth")}
                </TText>
                <TButton
                  title={t("home.viewAll")}
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
                        t("home.monthPastSubtitle", {
                          city: r.city ?? "",
                          score: Number(r.score_month ?? 0).toFixed(1),
                          count: Number(r.ratings_count_month ?? 0),
                        })
                      }
                      score={Number(r.avg_score ?? 0)}
                      n={Number(r.ratings_count ?? 0)}
                      badge={t("home.monthBadge")}
                    />
                  </Pressable>
                ))}
              </ScrollView>

              <View style={{ height: theme.spacing.lg + theme.spacing.sm }} />
            </>
          ) : null}

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <TText size={theme.font.h2} weight="700">
              {t("home.bestAllTime")}
            </TText>
            <TButton
              title={t("home.viewAll")}
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
                <RankCard
                  title={r.name}
                  subtitle={r.city}
                  score={Number(r.avg_score ?? 0)}
                  n={Number(r.ratings_count ?? 0)}
                />
              </Pressable>
            ))}
          </ScrollView>

          <View style={{ height: theme.spacing.lg + theme.spacing.sm }} />

          {/* Cerca de ti */}
          <View style={{ marginBottom: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText size={theme.font.h2} weight="700">
                {t("home.nearYou")}
              </TText>

              <TButton
                title={t("home.refresh")}
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
                {t("home.enableLocation")}
              </TText>
            ) : nearRows.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.sm }}>
                {nearRows.map((v) => (
                  <NearVenueCard key={v.id} v={v} cacheBust={coverBust} onPress={() => goVenue(v.id)} />
                ))}
              </ScrollView>
            ) : (
              <TText muted style={{ marginTop: 10 }}>{t("home.noNearbyWithCoords")}</TText>
            )}
          </View>

          {/* Nuevos */}
          <View style={{ marginBottom: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText size={theme.font.h2} weight="700">
                {t("home.newPlaces")}
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
              <TText muted style={{ marginTop: 10 }}>{t("home.noNewPlaces")}</TText>
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
              placeholder={t("home.searchPlaceholder")}
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
            <Chip label={t("home.chips.all")} active={chip === "all"} onPress={() => setChip("all")} />
            <Chip label={chipLabelCity} active={chip === "city"} onPress={() => setChip("city")} />
            <Chip label={t("home.chips.following")} active={chip === "following"} onPress={() => setChip("following")} />
            <Chip label={t("home.chips.mine")} active={chip === "mine"} onPress={() => setChip("mine")} />
          </View>

          {chip === "city" && selectedCity ? (
            <TButton
              title={t("home.removeFilter")}
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

          {chip === "city" && !selectedCity ? <TText muted style={{ marginTop: 8 }}>{t("home.chooseCityToFilter")}</TText> : null}

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

          {!exploreLoading && shouldShowExplore && exploreRows.length === 0 ? <TText muted style={{ marginTop: 10 }}>{t("home.noResults")}</TText> : null}
        </View>
      ) : null}
    </ScrollView>
  </SafeAreaView>
);
// </SECTION:RENDER>

}
// </SECTION:SCREEN>
