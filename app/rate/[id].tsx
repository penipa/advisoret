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

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";
import { RatingRing } from "../../src/ui/RatingRing";
import { CriterionHelpIcon } from "../../src/components/CriterionHelpIcon";

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
};

const clampScore = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

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

// ✅ mes calculado en UTC (alineado con month_bucket en BD)
function monthRangeISO() {
  const now = new Date();

  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );

  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export default function RateScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  // product_types.id para "esmorzaret"
  const ESMORZARET_PRODUCT_TYPE_ID = "5b0af5a5-e73a-4381-9796-c6676c285206";

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
          .select("id,code,name_es,name_en,sort_order")
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

  const parsedPrice = useMemo(() => {
    const t = price.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }, [price]);

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
        setSaveErr("No he podido cargar tu valoración.");
        return;
      }

      const rs = await supabase
        .from("rating_scores")
        .select("criterion_id,score")
        .eq("rating_id", ratingId);

      if (rs.error) {
        setSaveErr("No he podido cargar las puntuaciones de tu valoración.");
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

      setSaveMsg(msg ?? "Modo edición: cambia lo que quieras y guarda.");
    } finally {
      setEditLoading(false);
    }
  };

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
          "Ya has valorado este local este mes. Estás editando tu valoración."
        );
      }
    })();
  }, [id, criteria.length, prefillChecked, editRatingId]);

  const doInsertNew = async (userId: string) => {
    if (!id) return { error: { code: "NO_ID", message: "Missing id" }, ratingId: null };

    const insertRating = await supabase
      .from("ratings")
      .insert({
        venue_id: id,
        product_type_id: ESMORZARET_PRODUCT_TYPE_ID,
        user_id: userId,
        comment: comment.trim() ? comment.trim() : null,
        price_eur: parsedPrice === null ? null : parsedPrice,
      })
      .select("id")
      .single();

    if (insertRating.error) return { error: insertRating.error, ratingId: null };

    const ratingId = (insertRating.data as any).id as string;

    const scoreRows = buildScoreRows(ratingId);

    const insertScores = await supabase.from("rating_scores").insert(scoreRows);
    if (insertScores.error) return { error: insertScores.error, ratingId: null };

    return { error: null, ratingId };
  };

  const doUpdateExisting = async (ratingId: string) => {
    const up = await supabase
      .from("ratings")
      .update({
        comment: comment.trim() ? comment.trim() : null,
        price_eur: parsedPrice === null ? null : parsedPrice,
      })
      .eq("id", ratingId)
      .select("id");

    if (up.error) return up.error;
    if (!up.data || up.data.length === 0) {
      return { message: "No se pudo actualizar (0 filas). Revisa RLS/policies en ratings." } as any;
    }

    const del = await supabase
      .from("rating_scores")
      .delete()
      .eq("rating_id", ratingId)
      .select("rating_id");

    if (del.error) return del.error;
    if (!del.data) {
      return { message: "No se pudieron borrar scores (RLS/policies en rating_scores)." } as any;
    }

    const scoreRows = buildScoreRows(ratingId);

    const ins = await supabase.from("rating_scores").insert(scoreRows);
    if (ins.error) return ins.error;

    return null;
  };

  const saveRating = async () => {
    if (!id) return;
    if (editLoading) return;
    if (saving) return; // anti doble tap “por si acaso”

    setSaveErr(null);
    setSaveMsg(null);

    if (parsedPrice !== null && Number.isNaN(parsedPrice)) {
      setSaveErr("El precio no parece un número válido. Ej: 8.50");
      return;
    }

    // Guardrail: criterios/scores siempre consistentes
    if (!criteria.length) {
      setSaveErr("No hay criterios cargados. Revisa rating_criteria.");
      return;
    }

    setSaving(true);

    try {
      // normaliza scores antes de guardar (1..5, sin nulls)
      setScores((prev) => {
        const next: Record<string, number> = { ...prev };
        for (const c of criteria) next[c.id] = clampScore(next[c.id] ?? 4);
        return next;
      });

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        router.push("/auth");
        return;
      }

      const userId = session.user.id;

      // Modo edición: UPDATE real
      if (editRatingId) {
        const err = await doUpdateExisting(editRatingId);
        if (err) {
          setSaveErr(err.message);
          return;
        }

        setSaveMsg("Actualizado ✅");
        setTimeout(() => {
          router.replace({ pathname: "/venue/[id]", params: { id, t: String(Date.now()) } });
        }, 300);
        return;
      }

      // Modo nuevo: INSERT
      const res = await doInsertNew(userId);

      if (res.error) {
        const anyErr: any = res.error;

        // ✅ Duplicado mensual: UPDATE directo
        if (anyErr?.code === "23505") {
          const existingId = await getThisMonthRatingId(userId);
          if (existingId) {
            setEditRatingId(existingId);
            const err = await doUpdateExisting(existingId);
            if (err) {
              setSaveErr(err.message);
              return;
            }

            setSaveMsg("Actualizado ✅");
            setTimeout(() => {
              router.replace({ pathname: "/venue/[id]", params: { id, t: String(Date.now()) } });
            }, 300);
            return;
          }

          setSaveMsg("Ya has valorado este local este mes. Cargando tu valoración…");
          const fallbackId = await getThisMonthRatingId(userId);
          if (fallbackId) await loadRatingForEditById(fallbackId);
          return;
        }

        setSaveErr(res.error.message);
        return;
      }

      setSaveMsg("Guardado ✅ ¡Gracias!");
      setTimeout(() => {
        router.replace({ pathname: "/venue/[id]", params: { id, t: String(Date.now()) } });
      }, 300);
    } catch (e: any) {
      setSaveErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

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
              {editRatingId ? "Editar valoración" : "Valorar"}
            </TText>

            {error && (
              <TText style={{ color: theme.colors.danger, marginTop: theme.spacing.md }}>
                Error: {error}
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
                    <TText muted>{venueCount === 1 ? "1 reseña" : `${venueCount} reseñas`}</TText>
                  </View>
                </View>
              </TCard>
            )}

            <View style={{ height: theme.spacing.lg }} />

            <TText size={theme.font.h2} weight="800">
              Criterios
            </TText>

            <View style={{ marginTop: theme.spacing.sm }}>
              {loading && <TText muted>Cargando…</TText>}

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
                          1–5
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
              Detalles
            </TText>

            <TCard style={{ marginTop: theme.spacing.sm }}>
              <TText weight="700">Precio (€)</TText>
              <TextInput
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                placeholder="8.50"
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

              <TText weight="700">Comentario (opcional)</TText>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Qué has pedido, qué tal el cremaet…"
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
              <TButton title="Volver" variant="ghost" onPress={() => router.back()} disabled={isBusy} />
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
                  ? "Preparando edición..."
                  : saving
                  ? "Guardando..."
                  : editRatingId
                  ? "Guardar cambios"
                  : "Guardar valoración"
              }
              disabled={isBusy}
              onPress={() => void saveRating()}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
