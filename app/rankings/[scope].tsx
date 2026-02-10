import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, ScrollView, View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { BrandLockup } from "../../src/ui/BrandLockup";
import { TButton } from "../../src/ui/TButton";
import { TInput } from "../../src/ui/TInput";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";
import { RatingRing } from "../../src/ui/RatingRing";
import { useTranslation } from "react-i18next";

const BRAND_A = require("../../assets/branding/logo-a.png");

// <SECTION:UI_STRINGS>
const UI = {
  tagMonth: "Ranking - Mes",
  tagAll: "Ranking - Siempre",
  labelMonth: "Mes natural",
  labelAll: "Historico",
  ellipsis: "...",
  dash: "—",
};
// </SECTION:UI_STRINGS>

type RankRow = {
  venue_id: string;
  name: string;
  city: string;
  score: number;
  n: number;
};

function reviewsLabel(n: number) {
  if (!n || n <= 0) return "Sin resenas";
  if (n === 1) return "1 resena";
  return `${n} resenas`;
}

function monthRangeISO() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export default function RankingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const isMonth = scope === "month";

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        if (isMonth) {
          // ✅ Misma definicion que Home (si sigues con mes natural): media simple en el rango del mes
          const { startISO, endISO } = monthRangeISO();

          const r = await supabase
            .from("vw_rating_overall")
            .select("venue_id,overall_score,created_at")
            .gte("created_at", startISO)
            .lt("created_at", endISO)
            .limit(2000);

          if (r.error) throw new Error(r.error.message);

          const raw = (r.data ?? []) as Array<{ venue_id: string; overall_score: number }>;

          const agg = new Map<string, { sum: number; n: number }>();
          for (const it of raw) {
            const v = it.venue_id;
            const s = Number(it.overall_score ?? 0);
            const cur = agg.get(v) ?? { sum: 0, n: 0 };
            cur.sum += s;
            cur.n += 1;
            agg.set(v, cur);
          }

          const computed = Array.from(agg.entries()).map(([venue_id, a]) => ({
            venue_id,
            score: a.n > 0 ? a.sum / a.n : 0,
            n: a.n,
          }));

          computed.sort((a, b) => b.score - a.score);

          const ids = computed.map((x) => x.venue_id);
          const v = await supabase.from("venues").select("id,name,city").in("id", ids).limit(500);
          if (v.error) throw new Error(v.error.message);

          const venues = new Map<string, { name: string; city: string }>();
          for (const row of (v.data ?? []) as any[]) {
            venues.set(row.id, { name: row.name, city: row.city });
          }

          const finalRows: RankRow[] = computed
            .map((x) => ({
              venue_id: x.venue_id,
              name: venues.get(x.venue_id)?.name ?? UI.dash,
              city: venues.get(x.venue_id)?.city ?? "",
              score: x.score,
              n: x.n,
            }))
            .filter((x) => x.name !== UI.dash);

          if (!alive) return;
          setRows(finalRows);
        } else {
          // ✅ All-time bayesiano (como Home)
          const all = await supabase
            .from("vw_venue_rank_all_time")
            .select("venue_id,name,city,bayes_score,ratings_count")
            .order("bayes_score", { ascending: false })
            .limit(200);

          if (all.error) throw new Error(all.error.message);

          const finalRows: RankRow[] = ((all.data ?? []) as any[]).map((r) => ({
            venue_id: r.venue_id,
            name: r.name,
            city: r.city,
            score: Number(r.bayes_score ?? 0),
            n: Number(r.ratings_count ?? 0),
          }));

          if (!alive) return;
          setRows(finalRows);
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Error cargando rankings");
        setRows([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isMonth]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => (r.name ?? "").toLowerCase().includes(s) || (r.city ?? "").toLowerCase().includes(s));
  }, [rows, q]);

  // ✅ ranking real (posicion global), aunque filtres
  const rankByVenueId = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, idx) => m.set(r.venue_id, idx + 1));
    return m;
  }, [rows]);

  const isFiltering = q.trim().length > 0;
  const surface2 = (theme.colors as any).surface2 ?? theme.colors.surface;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
        <BrandLockup
          title="Advisoret"
          iconSource={BRAND_A}
          tag={isMonth ? t("rankings.monthTag") : t("rankings.allTag")}
          style={{ marginBottom: theme.spacing.lg + 6 }}
        />

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: theme.spacing.md,
            minHeight: 40,
          }}
        >
          <TButton
            title={t("common.goBack")}
            variant="ghost"
            onPress={() => router.back()}
            style={{ paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" }}
          />

          <View style={{ flexDirection: "row", alignItems: "center" }}>
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
                {loading
                  ? UI.ellipsis
                  : isFiltering
                    ? `Mostrando ${filtered.length} de ${rows.length}`
                    : `${rows.length} ${rows.length === 1 ? "local" : "locales"}`}
              </TText>
            </View>

            <TText muted style={{ marginLeft: 8 }}>
              {isMonth ? t("rankings.monthLabel") : t("rankings.allLabel")}
            </TText>
          </View>
        </View>

        <TInput
          value={q}
          onChangeText={setQ}
          placeholder={t("rankings.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          containerStyle={{ marginBottom: theme.spacing.md }}
        />

        {error ? (
          <TCard style={{ marginBottom: theme.spacing.md }}>
            <TText weight="800">Error</TText>
            <TText muted style={{ marginTop: 6 }}>
              {error}
            </TText>
          </TCard>
        ) : null}

        {loading ? (
          <TCard>
            <TText weight="800">Cargando{UI.ellipsis}</TText>
            <TText muted style={{ marginTop: 6 }}>{t("rankings.loading")}</TText>
          </TCard>
        ) : filtered.length === 0 ? (
          <TCard>
            <TText weight="800">Sin resultados</TText>
            <TText muted style={{ marginTop: 6 }}>{t("rankings.noResults")}</TText>
          </TCard>
        ) : (
          <View>
            {filtered.map((r) => {
              const rank = rankByVenueId.get(r.venue_id) ?? 0;

              return (
                <Pressable
                  key={r.venue_id}
                  onPress={() => router.push(`/venue/${r.venue_id}`)}
                  style={{ width: "100%", marginBottom: 10 }}
                >
                  <TCard>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <TText weight="800" numberOfLines={1}>
                          {rank}. {r.name}
                        </TText>

                        <TText muted style={{ marginTop: 6 }} numberOfLines={1}>
                          {r.city}
                        </TText>

                        <TText muted style={{ marginTop: 8 }}>{reviewsLabel(r.n)}</TText>
                      </View>

                      {r.n > 0 ? (
                        <RatingRing
                          value={Number(r.score ?? 0)}
                          max={5}
                          size={44}
                          strokeWidth={5}
                          showValue={true}
                          valueDecimals={1}
                          valueColor={theme.colors.gold}
                        />
                      ) : (
                        <View
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            minWidth: 64,
                            alignItems: "center",
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            backgroundColor: surface2,
                          }}
                        >
                          <TText size={12} weight="800">
                            NUEVO
                          </TText>
                        </View>
                      )}
                    </View>
                  </TCard>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
