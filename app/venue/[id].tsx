// <SECTION:IMPORTS>
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Linking,
  Alert,
  Pressable,
  Image,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

import { supabase, venueCoverUrl, STORAGE_BUCKET_VENUE_PHOTOS } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";
import { RatingRing } from "../../src/ui/RatingRing";
import * as ImageManipulator from "expo-image-manipulator";
import { Buffer } from "buffer";


// Reportes (función)
import { createVenueReport } from "../../src/lib/venueReports";

// Modal (import robusto para evitar undefined)
import * as ReportVenueModalModule from "../../src/components/ReportVenueModal";
// </SECTION:IMPORTS>

// <SECTION:CONSTS>
/**
 * Fallback anti-bloqueo:
 * Si por lo que sea se rompe el cálculo de admin en DB,
 * aquí nunca te quedas fuera si falta is_admin.
 */
const ADMIN_EMAIL_FALLBACK = "pablo_penichet@yahoo.es";

// Hoy: solo Esmorzaret. Mañana: este valor vendrá de selector/ruta.
const ESMORZARET_PRODUCT_TYPE_ID = "5b0af5a5-e73a-4381-9796-c6676c285206";
// </SECTION:CONSTS>

// <SECTION:TYPES>
type Venue = {
  id: string;
  name: string;
  city: string;
  address_text: string | null;
  google_maps_url: string | null;
  cover_photo_path: string | null;
  lat: number | null;
  lon: number | null;

  // Cacau d'Or (desde la view vw_venues_with_cacau)
  has_cacau_dor?: boolean | null;
  latest_cacau_year?: number | null;
  cacau_badge_text?: string | null;
  cacau_badge_subtext?: string | null;
};

type ReviewRow = {
  rating_id: string;
  user_id: string;
  created_at: string;
  comment: string | null;
  price_eur: number | null;
  overall_score: number;
};

type CriteriaBreakdownRow = {
  venue_id: string;
  product_type_id: string;
  criterion_id: string;
  code: string | null;
  name_es: string | null;
  name_en: string | null;
  avg_score: number; // numeric(10,4)
  n: number;
};

type RatingBreakdownRow = {
  rating_id: string;
  venue_id: string;
  product_type_id: string;
  criterion_id: string;
  code: string | null;
  name_es: string | null;
  name_en: string | null;
  sort_order: number | null;
  score: number; // int 1..5
};

type ProfileMini = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

type MyVenueReport = {
  id: string;
  status: "pending" | "approved" | "rejected";
  resolution_note: string | null;
  created_at: string;
};
// </SECTION:TYPES>

// <SECTION:HELPERS_FORMAT>
function fmtMoney(n: number | null) {
  if (n == null) return null;
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(Number(n));
  } catch {
    return `${n} €`;
  }
}

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

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function reviewsLabel(n: number) {
  if (n === 0) return "Sin reseñas";
  if (n === 1) return "1 reseña";
  return `${n} reseñas`;
}

function safeLatLon(lat?: number | null, lon?: number | null) {
  if (lat == null || lon == null) return null;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;
  return { lat, lon };
}
// </SECTION:HELPERS_FORMAT>

// <SECTION:SCREEN>
export default function VenueScreen() {
  // <SECTION:SCREEN_INIT>
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; t?: string }>();
  const id = params.id ?? "";

  const goRate = useCallback(() => {
    if (!id) return;
    router.push({ pathname: "/rate/[id]", params: { id } });
  }, [router, id]);

  // Modal component robusto: soporta export named o default
  const ReportVenueModalComp: any =
    (ReportVenueModalModule as any)?.ReportVenueModal ??
    (ReportVenueModalModule as any)?.default ??
    null;
  // </SECTION:SCREEN_INIT>

  // <SECTION:STATE_CORE>
  const [venue, setVenue] = useState<Venue | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [venueScore, setVenueScore] = useState<number>(0);
  const [venueCount, setVenueCount] = useState<number>(0);

  const [isAdmin, setIsAdmin] = useState(false);
  // </SECTION:STATE_CORE>

  // <SECTION:STATE_BREAKDOWNS>
  // Desglose por criterio (local)
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownErr, setBreakdownErr] = useState<string | null>(null);
  const [criteriaBreakdown, setCriteriaBreakdown] = useState<CriteriaBreakdownRow[] | null>(null);

  // Desglose por reseña (rating_id)
  const [reviewBreakdownOpen, setReviewBreakdownOpen] = useState<Record<string, boolean>>({});
  const [reviewBreakdownLoading, setReviewBreakdownLoading] = useState<Record<string, boolean>>({});
  const [reviewBreakdownErr, setReviewBreakdownErr] = useState<Record<string, string | null>>({});
  const [reviewBreakdownData, setReviewBreakdownData] = useState<Record<string, RatingBreakdownRow[]>>({});
  // </SECTION:STATE_BREAKDOWNS>

  // <SECTION:STATE_COVER>
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverBust, setCoverBust] = useState<number>(() => Date.now());
  const [coverLoadError, setCoverLoadError] = useState<string | null>(null);
  // </SECTION:STATE_COVER>

  // <SECTION:STATE_REPORTS>
  const [reportOpen, setReportOpen] = useState(false);

  // Mi reporte (feedback instantáneo)
  const [myReport, setMyReport] = useState<MyVenueReport | null>(null);
  const [myReportLoading, setMyReportLoading] = useState(false);
  // </SECTION:STATE_REPORTS>

  // <SECTION:AUTH_HELPERS>
  const getMyUserId = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.user?.id ?? null;
  }, []);

  const computeIsAdmin = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) return false;

    // Preferimos profiles.is_admin si existe (y si no, fallback por email)
    try {
      const p = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
      if (!p.error && p.data && typeof (p.data as any).is_admin === "boolean") {
        return Boolean((p.data as any).is_admin);
      }
    } catch {
      // ignore
    }

    const email = (user.email ?? "").toLowerCase();
    return email === ADMIN_EMAIL_FALLBACK.toLowerCase();
  }, []);
  // </SECTION:AUTH_HELPERS>

  // <SECTION:ADMIN_EFFECT>
  useEffect(() => {
    (async () => {
      try {
        const v = await computeIsAdmin();
        setIsAdmin(Boolean(v));
      } catch {
        setIsAdmin(false);
      }
    })();
  }, [computeIsAdmin]);
  // </SECTION:ADMIN_EFFECT>

  // <SECTION:LOAD_VENUE>
  const loadVenue = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    // Reset desglose
    setBreakdownOpen(false);
    setBreakdownErr(null);
    setCriteriaBreakdown(null);

    // Reset desglose por reseña
    setReviewBreakdownOpen({});
    setReviewBreakdownLoading({});
    setReviewBreakdownErr({});
    setReviewBreakdownData({});

    try {
      const vView = await supabase
        .from("vw_venues_with_cacau")
        .select(
          "id,name,city,address_text,google_maps_url,cover_photo_path,lat,lon,has_cacau_dor,latest_cacau_year,cacau_badge_text,cacau_badge_subtext"
        )
        .eq("id", id)
        .maybeSingle();

      const v =
        !vView.error && vView.data
          ? (vView.data as Venue)
          : (
              await supabase
                .from("venues")
                .select("id,name,city,address_text,google_maps_url,cover_photo_path,lat,lon")
                .eq("id", id)
                .single()
            ).data;

      if (!v) {
        setError(vView.error?.message ?? "No se encontró el local.");
        setVenue(null);
        setReviews([]);
        setProfiles({});
        return;
      }

      setVenue(v as Venue);

      // Puntuación a mostrar = media REAL basada en vw_rating_overall
      const stats = await supabase
        .from("vw_rating_overall")
        .select("overall_score", { count: "exact" })
        .eq("venue_id", id)
        .limit(2000);

      if (!stats.error && stats.data) {
        const arr = (stats.data ?? []) as Array<{ overall_score: number }>;
        const n = Number(stats.count ?? arr.length ?? 0);
        const sum = arr.reduce((acc, it) => acc + Number(it.overall_score ?? 0), 0);
        const avg = arr.length > 0 ? sum / arr.length : 0;

        setVenueScore(avg);
        setVenueCount(n);
      } else {
        setVenueScore(0);
        setVenueCount(0);
      }

      const r = await supabase
        .from("vw_rating_overall")
        .select("rating_id,user_id,created_at,comment,price_eur,overall_score")
        .eq("venue_id", id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (r.error) {
        setReviews([]);
      } else {
        setReviews((r.data ?? []) as any);
      }

      const userIds = Array.from(new Set((r.data ?? []).map((x: any) => x.user_id).filter(Boolean)));
      if (userIds.length) {
        const p = await supabase.from("profiles").select("id,display_name,avatar_url").in("id", userIds);
        if (!p.error) {
          const map: Record<string, ProfileMini> = {};
          (p.data ?? []).forEach((row: any) => (map[row.id] = row));
          setProfiles(map);
        }
      }

      // Mi reporte en esta ficha (si existe)
      const uid = await getMyUserId();
      if (uid) {
        setMyReportLoading(true);
        const mr = await supabase
          .from("venue_reports")
          .select("id,status,resolution_note,created_at")
          .eq("venue_id", id)
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!mr.error && mr.data) setMyReport(mr.data as any);
        else setMyReport(null);

        setMyReportLoading(false);
      } else {
        setMyReport(null);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [id, getMyUserId]);
  // </SECTION:LOAD_VENUE>

  // <SECTION:LOAD_CRITERIA_BREAKDOWN>
  const loadCriteriaBreakdown = useCallback(async () => {
    if (!id) return;
    if (breakdownLoading) return;

    setBreakdownLoading(true);
    setBreakdownErr(null);

    try {
      const r = await supabase
        .from("vw_venue_criteria_breakdown")
        .select("venue_id,product_type_id,criterion_id,code,name_es,name_en,avg_score,n")
        .eq("venue_id", id)
        .eq("product_type_id", ESMORZARET_PRODUCT_TYPE_ID);

      if (r.error) {
        setBreakdownErr(r.error.message);
        setCriteriaBreakdown([]);
        return;
      }

      const rows = ((r.data ?? []) as any[]).map((x) => ({
        venue_id: String(x.venue_id),
        product_type_id: String(x.product_type_id),
        criterion_id: String(x.criterion_id),
        code: x.code ?? null,
        name_es: x.name_es ?? null,
        name_en: x.name_en ?? null,
        avg_score: Number(x.avg_score ?? 0),
        n: Number(x.n ?? 0),
      })) as CriteriaBreakdownRow[];

      // Orden estable: por nombre
      rows.sort((a, b) => {
        const la = (a.name_es || a.name_en || "").toLocaleLowerCase("es-ES");
        const lb = (b.name_es || b.name_en || "").toLocaleLowerCase("es-ES");
        return la.localeCompare(lb, "es-ES");
      });

      setCriteriaBreakdown(rows);
    } catch (e: any) {
      setBreakdownErr(e?.message ?? String(e));
      setCriteriaBreakdown([]);
    } finally {
      setBreakdownLoading(false);
    }
  }, [id, breakdownLoading]);
  // </SECTION:LOAD_CRITERIA_BREAKDOWN>

  // <SECTION:LOAD_REVIEW_BREAKDOWN>
  const loadReviewBreakdown = useCallback(
    async (ratingId: string) => {
      if (!ratingId) return;
      if (reviewBreakdownLoading[ratingId]) return;
      if (reviewBreakdownData[ratingId]) return;

      setReviewBreakdownLoading((m) => ({ ...m, [ratingId]: true }));
      setReviewBreakdownErr((m) => ({ ...m, [ratingId]: null }));

      try {
        const r = await supabase
          .from("vw_rating_breakdown")
          .select("rating_id,venue_id,product_type_id,criterion_id,code,name_es,name_en,sort_order,score")
          .eq("rating_id", ratingId)
          .order("sort_order", { ascending: true });

        if (r.error) {
          setReviewBreakdownErr((m) => ({ ...m, [ratingId]: r.error.message }));
          setReviewBreakdownData((m) => ({ ...m, [ratingId]: [] }));
          return;
        }

        const rows = ((r.data ?? []) as any[]).map((x) => ({
          rating_id: String(x.rating_id),
          venue_id: String(x.venue_id),
          product_type_id: String(x.product_type_id),
          criterion_id: String(x.criterion_id),
          code: x.code ?? null,
          name_es: x.name_es ?? null,
          name_en: x.name_en ?? null,
          sort_order: x.sort_order != null ? Number(x.sort_order) : null,
          score: Number(x.score ?? 0),
        })) as RatingBreakdownRow[];

        rows.sort((a, b) => {
          const sa = a.sort_order ?? 9999;
          const sb = b.sort_order ?? 9999;
          if (sa !== sb) return sa - sb;
          const la = (a.name_es || a.name_en || "").toLocaleLowerCase("es-ES");
          const lb = (b.name_es || b.name_en || "").toLocaleLowerCase("es-ES");
          return la.localeCompare(lb, "es-ES");
        });

        setReviewBreakdownData((m) => ({ ...m, [ratingId]: rows }));
      } catch (e: any) {
        setReviewBreakdownErr((m) => ({ ...m, [ratingId]: e?.message ?? String(e) }));
        setReviewBreakdownData((m) => ({ ...m, [ratingId]: [] }));
      } finally {
        setReviewBreakdownLoading((m) => ({ ...m, [ratingId]: false }));
      }
    },
    [reviewBreakdownLoading, reviewBreakdownData]
  );
  // </SECTION:LOAD_REVIEW_BREAKDOWN>

  // <SECTION:EFFECTS_FOCUS_AND_COVER>
  useFocusEffect(
    useCallback(() => {
      void loadVenue();
    }, [loadVenue])
  );

  useEffect(() => {
    // cache bust al volver de una subida / refresh
    setCoverLoadError(null);
    setCoverBust(Date.now());
  }, [params.t]);

  // COVER: url + error handling
  const coverUrl = useMemo(() => {
    return venueCoverUrl(venue?.cover_photo_path ?? null, coverBust);
  }, [venue?.cover_photo_path, coverBust]);

  useEffect(() => {
    setCoverLoadError(null);
  }, [coverUrl]);
  // </SECTION:EFFECTS_FOCUS_AND_COVER>

  // <SECTION:DERIVED>
  const hasCoords = useMemo(() => safeLatLon(venue?.lat, venue?.lon), [venue?.lat, venue?.lon]);

  const reportDisabled = useMemo(() => Boolean(myReport), [myReport]);
  // </SECTION:DERIVED>

  // <SECTION:NAV_HELPERS>
  const goUser = useCallback(
    (uid: string) => {
      router.push({ pathname: "/user/[id]", params: { id: uid } });
    },
    [router]
  );
  // </SECTION:NAV_HELPERS>

  // <SECTION:ACTIONS_MAPS>
  const openInMaps = useCallback(async () => {
    if (!venue) return;

    const url = venue.google_maps_url;
    if (url) {
      const ok = await Linking.canOpenURL(url);
      if (ok) return Linking.openURL(url);
    }

    const coords = safeLatLon(venue.lat, venue.lon);
    if (!coords) {
      Alert.alert("No disponible", "Este local aún no tiene coordenadas.");
      return;
    }

    const label = encodeURIComponent(venue.name);
    const lat = coords.lat;
    const lon = coords.lon;

    const mapsUrl =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?ll=${lat},${lon}&q=${label}`
        : `geo:${lat},${lon}?q=${lat},${lon}(${label})`;

    const ok = await Linking.canOpenURL(mapsUrl);
    if (ok) return Linking.openURL(mapsUrl);

    Alert.alert("No disponible", "No he podido abrir mapas en este dispositivo.");
  }, [venue]);
  // </SECTION:ACTIONS_MAPS>

  // <SECTION:ACTIONS_ADMIN_COVER>
  const pickAndUploadCover = useCallback(async () => {
    if (!venue) return;
    if (!isAdmin) return;
    if (!id) return;
    if (coverUploading) return;

    setCoverUploading(true);
    setCoverLoadError(null);

    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permiso requerido", "Necesito acceso a tus fotos para subir la portada.");
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
        allowsEditing: true,
        aspect: [16, 9],
      });
      
      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      // uri -> bytes (robusto iOS: evita blobs vacíos / ph://)
      const manipulated = await ImageManipulator.manipulateAsync(asset.uri, [], {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });

      if (!manipulated.base64) {
        Alert.alert("Error", "No se pudo leer la imagen (base64 vacío).");
        return;
      }

      const bytes = Buffer.from(manipulated.base64, "base64");

      // Sanity check: nunca subir 0 bytes
      if (bytes.length === 0) {
        Alert.alert("Error", "Imagen vacía (0 bytes). No se sube.");
        return;
      }

      // Ruta estable (y compatible con venueCoverUrl): <venueId>/cover.jpg
      const path = `${id}/cover_${Date.now()}.jpg`;

      const up = await supabase.storage.from(STORAGE_BUCKET_VENUE_PHOTOS).upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "60",
      });

      if (up.error) {
        Alert.alert("Error", up.error.message);
        return;
      }

      const upd = await supabase.from("venues").update({ cover_photo_path: path }).eq("id", venue.id);
      if (upd.error) {
        Alert.alert("Error", upd.error.message);
        return;
      }

      setCoverLoadError(null);
      setCoverBust(Date.now());
      void loadVenue();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? String(e));
    } finally {
      setCoverUploading(false);
    }
  }, [venue, isAdmin, id, coverUploading, loadVenue]);
  // </SECTION:ACTIONS_ADMIN_COVER>

  // <SECTION:ACTIONS_ADMIN_COORDS>
  const ensureCoords = useCallback(async () => {
    if (!venue) return;
    if (!isAdmin) return;

    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permiso requerido", "Necesito permiso de localización.");
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const lat = current.coords.latitude;
      const lon = current.coords.longitude;

      const upd = await supabase.from("venues").update({ lat, lon }).eq("id", venue.id);
      if (upd.error) {
        Alert.alert("Error", upd.error.message);
        return;
      }

      Alert.alert("OK", "Coordenadas actualizadas.");
      void loadVenue();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? String(e));
    }
  }, [venue, isAdmin, loadVenue]);
  // </SECTION:ACTIONS_ADMIN_COORDS>

  // <SECTION:ACTIONS_REPORTS>
  const openReport = useCallback(() => {
    if (reportDisabled) return;
    setReportOpen(true);
  }, [reportDisabled]);

  const submitVenueReport = useCallback(
    async (payload: { reason: string; details?: string | null }) => {
      if (!id) return;

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        Alert.alert("Inicia sesión", "Necesitas iniciar sesión para reportar.");
        router.push("/auth");
        return;
      }

      try {
        // ✅ Firma según TS: (client, args)
        await createVenueReport(supabase as any, {
          venueId: id,
          reason: payload.reason,
          message: payload.details ?? undefined,
        });

        setReportOpen(false);
        Alert.alert("Gracias", "Reporte enviado. Lo revisaremos pronto.");
        void loadVenue();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo enviar el reporte.");
      }
    },
    [id, router, loadVenue]
  );
  // </SECTION:ACTIONS_REPORTS>

  // <SECTION:RENDER>
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 120 }}>
        {error ? <TText style={{ color: theme.colors.danger }}>Error: {error}</TText> : null}
        {loading ? <TText muted>Cargando…</TText> : null}

        {!loading && venue ? (
          <>
            {/* <SECTION:RENDER_HEADER> */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <TText size={theme.font.title} weight="800">
                  {venue.name}
                </TText>

                <TText muted style={{ marginTop: 6 }}>
                  {venue.city}
                  {venue.address_text ? ` · ${venue.address_text}` : ""}
                </TText>

                {/* Cacau d'Or */}
                {venue.has_cacau_dor ? (
                  <View style={{ marginTop: 10 }}>
                    <View
                      style={{
                        alignSelf: "flex-start",
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surface2,
                      }}
                    >
                      <TText weight="800">{venue.cacau_badge_text ?? "Cacau d'Or"}</TText>
                      {venue.cacau_badge_subtext ? (
                        <TText muted style={{ marginTop: 2 }}>
                          {venue.cacau_badge_subtext}
                        </TText>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </View>

              <TButton title="Valorar" onPress={goRate} />
            </View>
            {/* </SECTION:RENDER_HEADER> */}

            {/* <SECTION:RENDER_COVER_AND_MAPS> */}
            <View style={{ marginTop: theme.spacing.lg }}>
              <TCard>
                {coverUrl && !coverLoadError ? (
                  <Pressable onPress={isAdmin ? pickAndUploadCover : undefined}>
                    <Image
                      key={coverUrl}
                      source={{ uri: coverUrl }}
                      style={{
                        width: "100%",
                        height: 190,
                        borderRadius: theme.radius.lg,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surface2,
                      }}
                      resizeMode="cover"
                      onError={(ev) => {
                        const msg = (ev as any)?.nativeEvent?.error ?? "Error cargando imagen";
                        setCoverLoadError(String(msg));
                      }}
                    />
                  </Pressable>
                ) : (
                  <Pressable onPress={isAdmin ? pickAndUploadCover : undefined}>
                    <View
                      style={{
                        width: "100%",
                        height: 190,
                        borderRadius: theme.radius.lg,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surface2,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <TText weight="800" size={24}>
                        {(venue?.name ?? "A").trim().slice(0, 2).toUpperCase()}
                      </TText>

                      {isAdmin ? (
                        <TText muted style={{ marginTop: 6 }}>
                          {coverUploading ? "Subiendo…" : "Toca para subir portada"}
                        </TText>
                      ) : null}

                      {coverLoadError ? (
                        <TText muted style={{ marginTop: 6 }}>
                          {coverLoadError}
                        </TText>
                      ) : null}
                    </View>
                  </Pressable>
                )}

                <View style={{ height: 12 }} />

                <TText weight="800">Ubicación</TText>

                <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between", gap: 12 as any }}>
                  <TButton title="Abrir en mapas" onPress={openInMaps} />
                  {hasCoords ? (
                    <TButton
                      title="Copiar coords"
                      variant="ghost"
                      onPress={() =>
                        Alert.alert("Coordenadas", `${hasCoords.lat.toFixed(6)}, ${hasCoords.lon.toFixed(6)}`)
                      }
                    />
                  ) : (
                    <TButton
                      title="Sin coords"
                      variant="ghost"
                      onPress={() => Alert.alert("Info", "Aún sin coordenadas")}
                    />
                  )}
                </View>

                {isAdmin ? (
                  <View style={{ marginTop: 10 }}>
                    <TButton title="Actualizar coords aquí" variant="ghost" onPress={ensureCoords} />
                  </View>
                ) : null}
              </TCard>
            </View>
            {/* </SECTION:RENDER_COVER_AND_MAPS> */}

            {/* <SECTION:RENDER_REPORT_BUTTON> */}
            <View style={{ marginTop: theme.spacing.lg, alignSelf: "flex-start" }}>
              <Pressable
                disabled={reportDisabled}
                onPress={reportDisabled ? undefined : openReport}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  opacity: reportDisabled ? 0.55 : 1,
                }}
              >
                <TText weight="800" muted>
                  Reportar
                </TText>
              </Pressable>
            </View>
            {/* </SECTION:RENDER_REPORT_BUTTON> */}

            {/* <SECTION:RENDER_REPORT_STATUS> */}
            {myReportLoading ? (
              <TText muted style={{ marginTop: 10 }}>
                Cargando estado del reporte…
              </TText>
            ) : myReport ? (
              <View style={{ marginTop: 10 }}>
                <TCard>
                  <TText weight="800">{myReport.status === "pending" ? "Reporte enviado" : "Reporte revisado"}</TText>

                  <View style={{ marginTop: 10 }}>
                    <View
                      style={{
                        alignSelf: "flex-start",
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surface2,
                      }}
                    >
                      <TText weight="800">
                        {myReport.status === "pending"
                          ? "En revisión"
                          : myReport.status === "approved"
                          ? "Aprobado"
                          : "Rechazado"}
                      </TText>
                    </View>
                  </View>

                  <TText muted style={{ marginTop: 10 }}>
                    {fmtDateTime(myReport.created_at)}
                  </TText>

                  {myReport.status !== "pending" && myReport.resolution_note ? (
                    <TText muted style={{ marginTop: 10 }}>
                      {myReport.resolution_note}
                    </TText>
                  ) : null}
                </TCard>
              </View>
            ) : null}
            {/* </SECTION:RENDER_REPORT_STATUS> */}

            {/* <SECTION:RENDER_SCORE_AND_BREAKDOWN> */}
            <View style={{ marginTop: theme.spacing.lg }}>
              <TCard>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <TText weight="800">Puntuación</TText>
                    <TText muted style={{ marginTop: 6 }}>
                      {reviewsLabel(Number(venueCount ?? 0))}
                    </TText>
                  </View>

                  <RatingRing
                    value={Number(venueScore ?? 0)}
                    max={5}
                    size={54}
                    strokeWidth={6}
                    showValue={true}
                    valueDecimals={1}
                    valueColor="#C9A35C"
                  />
                </View>

                <View style={{ marginTop: 14 }}>
                  <Pressable
                    onPress={() => {
                      const next = !breakdownOpen;
                      setBreakdownOpen(next);
                      if (next && criteriaBreakdown === null) void loadCriteriaBreakdown();
                    }}
                    style={{
                      alignSelf: "flex-start",
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <TText muted weight="800">
                      {breakdownOpen ? "Ocultar desglose" : "Ver desglose"}
                    </TText>
                  </Pressable>

                  {breakdownOpen ? (
                    <View style={{ marginTop: 12 }}>
                      {breakdownLoading ? (
                        <TText muted>Cargando desglose…</TText>
                      ) : breakdownErr ? (
                        <TText style={{ color: theme.colors.danger }}>{breakdownErr}</TText>
                      ) : !criteriaBreakdown || criteriaBreakdown.length === 0 ? (
                        <TText muted>Aún no hay suficientes valoraciones para mostrar el desglose.</TText>
                      ) : (
                        criteriaBreakdown.map((row) => {
                          const name = row.name_es || row.name_en || "Criterio";
                          const v = Math.max(0, Math.min(5, Number(row.avg_score || 0)));
                          const pct = (v / 5) * 100;

                          return (
                            <View key={row.criterion_id} style={{ marginTop: 10 }}>
                              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                                <TText weight="700" style={{ flex: 1, paddingRight: 10 }} numberOfLines={1}>
                                  {name}
                                </TText>
                                <TText muted>
                                  {v.toFixed(1)} · {row.n}
                                </TText>
                              </View>

                              <View
                                style={{
                                  marginTop: 8,
                                  height: 10,
                                  borderRadius: 999,
                                  borderWidth: 1,
                                  borderColor: theme.colors.border,
                                  backgroundColor: theme.colors.surface2,
                                  overflow: "hidden",
                                }}
                              >
                                <View
                                  style={{
                                    width: `${pct}%`,
                                    height: "100%",
                                    backgroundColor: theme.colors.text,
                                    opacity: 0.15,
                                  }}
                                />
                              </View>
                            </View>
                          );
                        })
                      )}
                    </View>
                  ) : null}
                </View>
              </TCard>
            </View>
            {/* </SECTION:RENDER_SCORE_AND_BREAKDOWN> */}

            {/* <SECTION:RENDER_REVIEWS> */}
            <View style={{ marginTop: theme.spacing.lg }}>
              <TText size={theme.font.h2} weight="700">
                Reseñas
              </TText>

              {reviews.length === 0 ? (
                <TText muted style={{ marginTop: theme.spacing.sm }}>
                  Aún no hay reseñas.
                </TText>
              ) : (
                <View style={{ marginTop: theme.spacing.sm }}>
                  {reviews.map((r) => {
                    const p = profiles[r.user_id];

                    const open = Boolean(reviewBreakdownOpen[r.rating_id]);
                    const isL = Boolean(reviewBreakdownLoading[r.rating_id]);
                    const err = reviewBreakdownErr[r.rating_id] ?? null;
                    const data = reviewBreakdownData[r.rating_id];

                    return (
                      <View key={r.rating_id} style={{ marginBottom: theme.spacing.sm }}>
                        <Pressable onPress={() => goUser(r.user_id)}>
                          <TCard>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                              <View style={{ flex: 1, paddingRight: 12 }}>
                                <TText weight="800" numberOfLines={1}>
                                  {p?.display_name ?? "Usuario"}
                                </TText>
                                <TText muted style={{ marginTop: 6 }}>
                                  {fmtDate(r.created_at)}
                                  {r.price_eur != null ? ` · ${fmtMoney(r.price_eur)}` : ""}
                                </TText>
                              </View>

                              <View
                                style={{
                                  paddingHorizontal: 10,
                                  paddingVertical: 6,
                                  borderRadius: 999,
                                  borderWidth: 1,
                                  borderColor: theme.colors.border,
                                  backgroundColor: theme.colors.surface2,
                                  minWidth: 54,
                                  alignItems: "center",
                                }}
                              >
                                <TText weight="800">{Number(r.overall_score ?? 0).toFixed(1)}</TText>
                              </View>
                            </View>

                            {r.comment ? (
                              <TText style={{ marginTop: 12, lineHeight: 20 }} muted>
                                {r.comment}
                              </TText>
                            ) : null}

                            {/* Desglose de ESTA reseña */}
                            <View style={{ marginTop: 14 }}>
                              <Pressable
                                onPress={() => {
                                  const next = !open;
                                  setReviewBreakdownOpen((m) => ({ ...m, [r.rating_id]: next }));
                                  if (next && !reviewBreakdownData[r.rating_id]) void loadReviewBreakdown(r.rating_id);
                                }}
                                style={{
                                  alignSelf: "flex-start",
                                  paddingVertical: 8,
                                  paddingHorizontal: 12,
                                  borderRadius: 999,
                                  borderWidth: 1,
                                  borderColor: theme.colors.border,
                                  backgroundColor: theme.colors.surface2,
                                }}
                              >
                                <TText muted weight="800">
                                  {open ? "Ocultar desglose" : "Ver desglose"}
                                </TText>
                              </Pressable>
                              
                              {open ? (
                                <View style={{ marginTop: 12 }}>
                                  {r.price_eur != null ? (
                                    <TText muted style={{ marginBottom: 8 }}>
                                      Precio: {fmtMoney(r.price_eur)}
                                    </TText>
                                  ) : null}

                                  {isL ? (
                                    <TText muted>Cargando desglose…</TText>
                                  ) : err ? (
                                    <TText style={{ color: theme.colors.danger }}>{err}</TText>
                                  ) : !data || data.length === 0 ? (
                                    <TText muted>Esta reseña no tiene desglose disponible.</TText>
                                  ) : (
                                    data.map((row) => {
                                      const name = row.name_es || row.name_en || "Criterio";
                                      const v = Math.max(0, Math.min(5, Number(row.score || 0)));
                                      const pct = (v / 5) * 100;

                                      return (
                                        <View key={row.criterion_id} style={{ marginTop: 10 }}>
                                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                                            <TText weight="700" style={{ flex: 1, paddingRight: 10 }} numberOfLines={1}>
                                              {name}
                                            </TText>
                                            <TText muted>{v.toFixed(0)}</TText>
                                          </View>

                                          <View
                                            style={{
                                              marginTop: 8,
                                              height: 10,
                                              borderRadius: 999,
                                              borderWidth: 1,
                                              borderColor: theme.colors.border,
                                              backgroundColor: theme.colors.surface2,
                                              overflow: "hidden",
                                            }}
                                          >
                                            <View
                                              style={{
                                                width: `${pct}%`,
                                                height: "100%",
                                                backgroundColor: theme.colors.text,
                                                opacity: 0.15,
                                              }}
                                            />
                                          </View>
                                        </View>
                                      );
                                    })
                                  )}
                                </View>
                              ) : null}
                            </View>
                          </TCard>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
            {/* </SECTION:RENDER_REVIEWS> */}

            {/* <SECTION:RENDER_FOOTER> */}
            <View style={{ marginTop: theme.spacing.xl }}>
              <TButton title="Volver" variant="ghost" onPress={() => router.back()} />
            </View>

            {reportOpen && ReportVenueModalComp ? (
              <ReportVenueModalComp open={true} onClose={() => setReportOpen(false)} onSubmit={submitVenueReport} />
            ) : null}
            {/* </SECTION:RENDER_FOOTER> */}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
  // </SECTION:RENDER>
}
// </SECTION:SCREEN>
