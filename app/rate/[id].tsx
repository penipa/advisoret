// <SECTION:IMPORTS>
import { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";
import { RatingRing } from "../../src/ui/RatingRing";
import { CriterionHelpIcon } from "../../src/components/CriterionHelpIcon";
// </SECTION:IMPORTS>

// <SECTION:TYPES>
type Venue = {
  id: string;
  name: string;
  city: string;
  address_text: string | null;
};

type Criterion = {
  id: string;
  code?: string | null;
  name_es: string;
  name_en: string;
  sort_order: number;

  // ✅ NUEVO: tooltips editables en Supabase
  help_es?: string | null;
  help_en?: string | null;
};
// </SECTION:TYPES>

// <SECTION:HELPERS>
const clampScore = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

// ✅ mes calculado en UTC (alineado con month_bucket en BD)
function monthRangeISO() {
  const now = new Date();

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

  return { startISO: start.toISOString(), endISO: end.toISOString() };
}
// </SECTION:HELPERS>

// <SECTION:UI_STEPPER>
function Stepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const dec = () => onChange(clampScore(value - 1));
  const inc = () => onChange(clampScore(value + 1));

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 as any }}>
      <TButton title="-" variant="ghost" onPress={dec} disabled={disabled} />
      <View
        style={{
          minWidth: 44,
          paddingVertical: 10,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: "center",
          backgroundColor: theme.colors.surface2,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <TText weight="800">{clampScore(value)}</TText>
      </View>
      <TButton title="+" variant="ghost" onPress={inc} disabled={disabled} />
    </View>
  );
}
// </SECTION:UI_STEPPER>

// <SECTION:SCREEN>
export default function RateScreen() {
  // <SECTION:SCREEN_INIT>
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  // product_types.id para "esmorzaret"
  const ESMORZARET_PRODUCT_TYPE_ID = "5b0af5a5-e73a-4381-9796-c6676c285206";
  // </SECTION:SCREEN_INIT>

  // <SECTION:STATE_CORE>
  const [venue, setVenue] = useState<Venue | null>(null);

  // ✅ score del local (igual que Home/Detalle)
  const [venueScore, setVenueScore] = useState<number>(0);
  const [venueCount, setVenueCount] = useState<number>(0);

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [price, setPrice] = useState<string>("");
  const [comment, setComment] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // si existe, estamos editando esa rating
  const [editRatingId, setEditRatingId] = useState<string | null>(null);

  // mientras precargamos tu rating existente para editar
  const [editLoading, setEditLoading] = useState(false);

  // evita que el auto-prefill se ejecute en bucle
  const [prefillChecked, setPrefillChecked] = useState(false);

  const isBusy = saving || editLoading;

  const label = (c: Criterion) => c.name_es || c.name_en;
  // </SECTION:STATE_CORE>

  // <SECTION:EFFECT_LOAD_VENUE_AND_CRITERIA>
  useEffect(() => {
    if (!id) return;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const v = await supabase
          .from("venues")
          .select("id,name,city,address_text")
          .eq("id", id)
          .single();

        if (v.error) {
          setError(v.error.message);
          setLoading(false);
          return;
        }
        setVenue(v.data as Venue);

        // ✅ score del local desde el ranking all-time (mismo origen que Home/Detalle)
        const s = await supabase
          .from("vw_venue_rank_all_time")
          .select("bayes_score,ratings_count")
          .eq("venue_id", id)
          .maybeSingle();

        if (!s.error && s.data) {
          setVenueScore(Number((s.data as any).bayes_score ?? 0));
          setVenueCount(Number((s.data as any).ratings_count ?? 0));
        }

        const c = await supabase
          .from("rating_criteria")
          // ✅ NUEVO: traemos help_es/help_en desde Supabase
          .select("id,code,name_es,name_en,help_es,help_en,sort_order")
          .eq("product_type_id", ESMORZARET_PRODUCT_TYPE_ID)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });

        if (c.error) {
          setError(c.error.message);
          setLoading(false);
          return;
        }

        const list = (c.data ?? []) as Criterion[];
        setCriteria(list);

        // ⚠️ importante: no pises scores si ya están cargados (por edición)
        setScores((prev) => {
          const next = { ...prev };
          // inicializa defaults para criterios nuevos
          for (const item of list) {
            const existing = next[item.id];
            next[item.id] = clampScore(typeof existing === "number" ? existing : 4);
          }
          return next;
        });
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);
  // </SECTION:EFFECT_LOAD_VENUE_AND_CRITERIA>

  // <SECTION:DERIVED_PRICE>
  const parsedPrice = useMemo(() => {
    const t = price.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }, [price]);
  // </SECTION:DERIVED_PRICE>

  // <SECTION:HELPERS_EXISTING_RATING>
  const getThisMonthRatingId = async (userId: string) => {
    if (!id) return null;
    const { startISO, endISO } = monthRangeISO();

    const existing = await supabase
      .from("ratings")
      .select("id,created_at")
      .eq("venue_id", id)
      .eq("user_id", userId)
      .gte("created_at", startISO)
      .lt("created_at", endISO)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing.error) return null;
    return existing.data?.id ?? null;
  };

  const buildScoreRows = (ratingId: string) => {
    // Siempre guardamos 1 fila por criterio activo (robusto ante "scores" incompletos)
    return criteria.map((c) => ({
      rating_id: ratingId,
      criterion_id: c.id,
      score: clampScore(scores[c.id] ?? 4),
    }));
  };
  // </SECTION:HELPERS_EXISTING_RATING>

  // <SECTION:LOAD_RATING_FOR_EDIT>
  const loadRatingForEditById = async (ratingId: string, msg?: string) => {
    setEditLoading(true);
    setSaveErr(null);
    if (msg) setSaveMsg(msg);

    try {
      const r = await supabase
        .from("ratings")
        .select("id,comment,price_eur")
        .eq("id", ratingId)
        .single();

      if (r.error || !r.data?.id) {
        setSaveErr(t("rate.errors.loadYourRating"));
        return;
      }

      const rs = await supabase
        .from("rating_scores")
        .select("criterion_id,score")
        .eq("rating_id", ratingId);

      if (rs.error) {
        setSaveErr(t("rate.errors.loadYourScores"));
        return;
      }

      setEditRatingId(ratingId);
      setComment(r.data.comment ?? "");
      setPrice(r.data.price_eur != null ? String(r.data.price_eur) : "");

      // base: todos los criterios a 4, luego aplicamos los guardados
      setScores((prev) => {
        const base: Record<string, number> =
          Object.keys(prev).length > 0
            ? { ...prev }
            : Object.fromEntries(criteria.map((c) => [c.id, 4]));

        for (const row of (rs.data ?? []) as any[]) {
          base[row.criterion_id] = clampScore(Number(row.score));
        }

        // asegurar que todos los criterios activos existen
        for (const c of criteria) {
          base[c.id] = clampScore(base[c.id] ?? 4);
        }

        return base;
      });

      setSaveMsg(msg ?? t("rate.editModeHint"));
    } finally {
      setEditLoading(false);
    }
  };
  // </SECTION:LOAD_RATING_FOR_EDIT>

  // <SECTION:EFFECT_PREFILL_THIS_MONTH>
  // ✅ Auto-cargar tu valoración del mes al entrar (evita el “doble guardado”)
  useEffect(() => {
    if (!id) return;
    if (!criteria.length) return; // necesitamos los criterios para no pisar scores luego
    if (prefillChecked) return;
    if (editRatingId) return;

    (async () => {
      setPrefillChecked(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) return;

      const userId = session.user.id;
      const existingId = await getThisMonthRatingId(userId);

      if (existingId) {
        await loadRatingForEditById(
          existingId,
          t("rate.prefillEditingThisMonth")
        );
      }
    })();
  }, [id, criteria.length, prefillChecked, editRatingId]);
  // </SECTION:EFFECT_PREFILL_THIS_MONTH>

// <SECTION:DB_MUTATIONS>
const saveRating = async () => {
  if (!id) return;
  if (editLoading) return;
  if (saving) return; // anti doble tap “por si acaso”

  setSaveErr(null);
  setSaveMsg(null);

  // Precio obligatorio (MVP-safe: validación en cliente; la RPC también lo exige)
  if (parsedPrice === null) {
    setSaveErr(t("rate.errors.priceRequired"));
    return;
  }
  if (Number.isNaN(parsedPrice)) {
    setSaveErr(t("rate.errors.priceInvalid"));
    return;
  }

  // Guardrail: criterios/scores siempre consistentes
  if (!criteria.length) {
    setSaveErr(t("rate.errors.noCriteriaLoaded"));
    return;
  }

  setSaving(true);

  try {
    // Normaliza scores (1..5, sin nulls) en un objeto local
    const normalizedScores: Record<string, number> = {};
    for (const c of criteria) normalizedScores[c.id] = clampScore(scores[c.id] ?? 4);

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.push("/auth");
      return;
    }

    const payload = {
      p_venue_id: id,
      p_product_type_id: ESMORZARET_PRODUCT_TYPE_ID,
      p_price_eur: parsedPrice,
      p_comment: comment,
      p_scores: normalizedScores,
    };

    const res = await supabase.rpc("submit_rating_v1", payload);

    if (res.error) {
      setSaveErr(res.error.message);
      return;
    }

    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    const action = (row as any)?.action as string | undefined;

    if (action === "inserted_new_period") {
      setSaveMsg(t("rate.saved.newPeriod"));
    } else if (action === "overwritten") {
      setSaveMsg(t("rate.saved.updated"));
    } else {
      setSaveMsg(t("rate.saved.saved"));
    }

    setTimeout(() => {
      router.replace({ pathname: "/venue/[id]", params: { id, t: String(Date.now()) } });
    }, 300);
  } catch (e: any) {
    setSaveErr(e?.message ?? String(e));
  } finally {
    setSaving(false);
  }
};
// </SECTION:DB_MUTATIONS>

  // <SECTION:RENDER>
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{
              padding: theme.spacing.md,
              paddingBottom: 190,
            }}
          >
            <TText size={theme.font.title} weight="800">
              {editRatingId ? t("rate.titleEdit") : t("rate.title")}
            </TText>

            {error && (
              <TText style={{ color: theme.colors.danger, marginTop: theme.spacing.md }}>
                {t("common.error")}: {error}
              </TText>
            )}

            {venue && (
              <TCard style={{ marginTop: theme.spacing.lg }}>
                <TText weight="800" size={18} numberOfLines={1}>
                  {venue.name}
                </TText>
                <TText muted style={{ marginTop: 6 }}>
                  {venue.city}
                  {venue.address_text ? ` · ${venue.address_text}` : ""}
                </TText>

                {/* ✅ Score del local (igual que Home/Detalle): solo anillo con 1 decimal */}
                <View style={{ marginTop: theme.spacing.md, flexDirection: "row", alignItems: "center" }}>
                  <RatingRing
                    value={venueScore}
                    max={5}
                    size={52}
                    strokeWidth={6}
                    showValue={true}
                    valueDecimals={1}
                    valueColor="#C9A35C"
                  />
                  <View style={{ marginLeft: 12 }}>
                    <TText muted>
                      {venueCount === 1
                        ? t("rate.reviews.one")
                        : t("rate.reviews.many", { count: venueCount })}
                    </TText>
                  </View>
                </View>
              </TCard>
            )}

            <View style={{ height: theme.spacing.lg }} />

            <TText size={theme.font.h2} weight="800">
              {t("rate.criteriaTitle")}
            </TText>

            <View style={{ marginTop: theme.spacing.sm }}>
              {loading && <TText muted>{t("common.loading")}</TText>}

              {!loading &&
                criteria.map((c) => (
                  <TCard key={c.id} style={{ marginBottom: theme.spacing.sm }}>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <TText weight="800" style={{ flexShrink: 1 }}>
                            {label(c)}
                          </TText>

                          <View style={{ width: 10 }} />

                          <CriterionHelpIcon
                            productTypeId={ESMORZARET_PRODUCT_TYPE_ID}
                            criterion={c}
                          />
                        </View>

                        <TText muted style={{ marginTop: 4 }}>
                          {t("rate.range")}
                        </TText>
                      </View>

                      <Stepper
                        value={scores[c.id] ?? 4}
                        disabled={isBusy}
                        onChange={(v) =>
                          setScores((s) => ({ ...s, [c.id]: clampScore(v) }))
                        }
                      />
                    </View>
                  </TCard>
                ))}
            </View>

            <View style={{ height: theme.spacing.lg }} />

            <TText size={theme.font.h2} weight="800">
              {t("rate.detailsTitle")}
            </TText>

            <TCard style={{ marginTop: theme.spacing.sm }}>
              <TText weight="700">{t("rate.priceLabel")}</TText>
              <TextInput
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder={t("rate.pricePlaceholder")}
                placeholderTextColor={theme.colors.textMuted}
                editable={!isBusy}
                style={{
                  marginTop: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                  backgroundColor: theme.colors.surface2,
                  opacity: isBusy ? 0.65 : 1,
                }}
              />

              <View style={{ height: theme.spacing.md }} />

              <TText weight="700">{t("rate.commentLabel")}</TText>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder={t("rate.commentPlaceholder")}
                placeholderTextColor={theme.colors.textMuted}
                multiline
                editable={!isBusy}
                style={{
                  marginTop: 10,
                  minHeight: 110,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                  backgroundColor: theme.colors.surface2,
                  opacity: isBusy ? 0.65 : 1,
                }}
              />
            </TCard>

            <View style={{ marginTop: theme.spacing.lg }}>
              <TButton title={t("common.goBack")} variant="ghost" onPress={() => router.back()} disabled={isBusy} />
            </View>
          </ScrollView>

          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              padding: theme.spacing.md,
              paddingBottom: theme.spacing.md + 6,
              backgroundColor: theme.colors.bg,
              borderTopWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            {saveErr && (
              <TText style={{ color: theme.colors.danger, marginBottom: 10 }}>
                {saveErr}
              </TText>
            )}

            {saveMsg && (
              <TText style={{ marginBottom: 10 }} weight="700">
                {saveMsg}
              </TText>
            )}

            <TButton
              title={
                editLoading
                  ? t("rate.cta.preparingEdit")
                  : saving
                  ? t("rate.cta.saving")
                  : editRatingId
                  ? t("rate.cta.saveChanges")
                  : t("rate.cta.saveRating")
              }
              disabled={isBusy}
              onPress={() => void saveRating()}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
  // </SECTION:RENDER>
}
// </SECTION:SCREEN>
