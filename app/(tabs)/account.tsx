import { useEffect, useMemo, useState, useCallback } from "react";
import { SafeAreaView, View, Alert, ScrollView, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import i18n from "../../src/i18n";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { BrandLockup } from "../../src/ui/BrandLockup";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";

import { reviewVenueProposal } from "../../src/lib/venueProposals";

const BRAND_A = require("../../assets/branding/logo-a.png");

// ✅ Fallback anti-bloqueo (igual que en venue/[id].tsx)
const ADMIN_EMAIL_FALLBACK = "pablo_penichet@yahoo.es";

type Profile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

type VenueSuggestion = {
  id: string;
  created_at: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  resolution_note: string | null;
  venue_id: string | null;
  user_id?: string | null;
  message?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  kind?: string | null;
  venue?: { name: string | null; city: string | null } | null;
};

type VenueProposalRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  reviewed_by: string | null;
  resolution_note: string | null;

  // campos de propuesta (pueden variar)
  name?: string | null;
  city?: string | null;
  address_text?: string | null;
  google_maps_url?: string | null;
  notes?: string | null;
  message?: string | null; // por si en algún momento cambiaste nombre
};

function fmtDateTime(iso: string) {
  try {
    const locale = i18n.language === "en" ? "en-US" : "es-ES";
    return new Date(iso).toLocaleString(locale, {
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

function statusLabel(s: "pending" | "approved" | "rejected") {
  if (s === "approved") return "Aprobado";
  if (s === "rejected") return "Rechazado";
  return "Pendiente";
}

function shortId(id?: string | null) {
  const v = (id ?? "").trim();
  if (!v) return "—";
  return v.slice(0, 6);
}

export default function AccountScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const [boot, setBoot] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // ✅ Mis reportes (venue_suggestions)
  const [reports, setReports] = useState<VenueSuggestion[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);

  // ✅ Admin: moderación reportes (venue_suggestions)
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminTab, setAdminTab] = useState<"pending" | "reviewed">("pending");
  const [adminRows, setAdminRows] = useState<VenueSuggestion[]>([]);

  // ✅ Mis propuestas (venue_proposals)
  const [myProposals, setMyProposals] = useState<VenueProposalRow[]>([]);
  const [myProposalsLoading, setMyProposalsLoading] = useState(false);
  const [myProposalsError, setMyProposalsError] = useState<string | null>(null);

  // ✅ Admin: moderación altas (venue_proposals)
  const [adminProposalsTab, setAdminProposalsTab] = useState<"pending" | "reviewed">("pending");
  const [adminProposalsLoading, setAdminProposalsLoading] = useState(false);
  const [adminProposalsError, setAdminProposalsError] = useState<string | null>(null);
  const [adminProposals, setAdminProposals] = useState<VenueProposalRow[]>([]);

  // ✅ Badge: pendientes (admin)
  const [pendingCounts, setPendingCounts] = useState<{ suggestions: number; proposals: number }>({
    suggestions: 0,
    proposals: 0,
  });

  // ✅ Cache de perfiles para mostrar nombres en moderación (sirve para ambos: reportes y altas)
  const [adminProfiles, setAdminProfiles] = useState<
    Record<string, { display_name: string | null; username: string | null }>
  >({});

  const mergeProfiles = useCallback(
    (incoming: Record<string, { display_name: string | null; username: string | null }>) => {
      setAdminProfiles((prev) => ({ ...prev, ...incoming }));
    },
    []
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        setSession(data.session ?? null);
      } finally {
        if (alive) setBoot(false);
      }
    })();

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!session?.user?.id) {
        setProfile(null);
        return;
      }
      setProfileLoading(true);
      try {
        const p = await supabase
          .from("profiles")
          .select("id,display_name,username,avatar_url")
          .eq("id", session.user.id)
          .maybeSingle();

        if (!alive) return;
        if (p.error) setProfile(null);
        else setProfile((p.data ?? null) as any);
      } finally {
        if (alive) setProfileLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [session?.user?.id]);

  // ✅ Determinar admin (con fallback email)
  const loadIsAdmin = useCallback(async () => {
    const uid = session?.user?.id;
    const email = (session?.user?.email ?? "").toLowerCase().trim();
    if (!uid) {
      setIsAdmin(false);
      return;
    }

    const emailFallback = email === ADMIN_EMAIL_FALLBACK;

    try {
      const p = await supabase.from("profiles").select("is_admin").eq("id", uid).maybeSingle();

      if (p.error || !p.data) {
        setIsAdmin(emailFallback);
        return;
      }

      const flag = (p.data as any)?.is_admin;
      if (flag === null || flag === undefined) {
        setIsAdmin(emailFallback);
        return;
      }

      setIsAdmin(Boolean(flag) || emailFallback);
    } catch {
      setIsAdmin(emailFallback);
    }
  }, [session?.user?.id, session?.user?.email]);

  useEffect(() => {
    void loadIsAdmin();
  }, [loadIsAdmin]);

  const who = useMemo(() => {
    if (!session) return null;
    return (
      profile?.display_name ||
      (profile?.username ? `@${profile.username}` : null) ||
      session.user.email ||
      "Usuario"
    );
  }, [session, profile]);

  const adminUserLabel = useCallback(
    (userId?: string | null) => {
      const pid = (userId ?? "").trim();
      if (!pid) return "u:—";
      const p = adminProfiles[pid];
      const label = (p?.display_name ?? (p?.username ? `@${p.username}` : "")).trim();
      return label ? label : `u:${shortId(pid)}`;
    },
    [adminProfiles]
  );

  const goLogin = () => router.replace("/auth");

  const applyLanguage = useCallback(
    async (lang: "es" | "en") => {
      try {
        if (i18n.language !== lang) {
          await i18n.changeLanguage(lang);
        }
        await AsyncStorage.setItem("lang", lang);
        if (session) {
          await supabase.auth.updateUser({ data: { lang } });
        }
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No se pudo cambiar el idioma.");
      }
    },
    [session]
  );

  const changeAccount = async () => {
    try {
      await supabase.auth.signOut();
      router.replace("/auth");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo cambiar de cuenta.");
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      router.replace("/auth");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo cerrar sesión.");
    }
  };

  // ✅ Badge counts (admin)
  const loadPendingCounts = useCallback(async () => {
    if (!session?.user?.id) return;
    if (!isAdmin) return;

    try {
      const a = await supabase
        .from("venue_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      const b = await supabase
        .from("venue_proposals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      setPendingCounts({
        suggestions: a.count ?? 0,
        proposals: b.count ?? 0,
      });
    } catch {
      // silencioso (MVP)
    }
  }, [isAdmin, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!isAdmin) return;
    void loadPendingCounts();
  }, [isAdmin, loadPendingCounts, session?.user?.id]);

  // -----------------------------
  // Mis reportes (venue_suggestions)
  // -----------------------------
  const loadReports = useCallback(async (uid: string) => {
    setReportsLoading(true);
    setReportsError(null);
    try {
      const r = await supabase
        .from("venue_suggestions")
        .select("id,created_at,status,reason,resolution_note,venue_id,venue:venues(name,city)")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(20);

      if (r.error) {
        setReports([]);
        setReportsError(r.error.message);
        return;
      }

      setReports((r.data ?? []) as any);
    } catch (e: any) {
      setReports([]);
      setReportsError(e?.message ?? "No se pudieron cargar los reportes.");
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setReports([]);
      setReportsError(null);
      setReportsLoading(false);
      return;
    }
    void loadReports(uid);
  }, [loadReports, session?.user?.id]);

  // -----------------------------
  // Admin reportes (venue_suggestions)
  // -----------------------------
  const loadAdminReports = useCallback(
    async (scope: "pending" | "reviewed") => {
      if (!session?.user?.id) return;
      if (!isAdmin) return;

      setAdminLoading(true);
      setAdminError(null);

      try {
        const q =
          scope === "pending"
            ? supabase
                .from("venue_suggestions")
                .select(
                  "id,created_at,status,reason,message,resolution_note,venue_id,user_id,reviewed_at,reviewed_by,venue:venues(name,city)"
                )
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(50)
            : supabase
                .from("venue_suggestions")
                .select(
                  "id,created_at,status,reason,message,resolution_note,venue_id,user_id,reviewed_at,reviewed_by,venue:venues(name,city)"
                )
                .in("status", ["approved", "rejected"])
                .order("reviewed_at", { ascending: false })
                .limit(50);

        const r = await q;

        if (r.error) {
          setAdminRows([]);
          setAdminError(r.error.message);
          return;
        }

        const rows = (r.data ?? []) as any[];
        setAdminRows(rows as any);

        // perfiles (para nombre)
        const uids = Array.from(new Set(rows.map((x) => x.user_id).filter(Boolean)));
        if (uids.length > 0) {
          const p = await supabase.from("profiles").select("id,display_name,username").in("id", uids);
          if (!p.error) {
            const map: Record<string, { display_name: string | null; username: string | null }> = {};
            for (const it of (p.data ?? []) as any[]) {
              map[it.id] = { display_name: it.display_name ?? null, username: it.username ?? null };
            }
            mergeProfiles(map);
          }
        }
      } catch (e: any) {
        setAdminRows([]);
        setAdminError(e?.message ?? "No se pudieron cargar los reportes (admin).");
      } finally {
        setAdminLoading(false);
      }
    },
    [isAdmin, mergeProfiles, session?.user?.id]
  );

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!isAdmin) return;
    void loadAdminReports(adminTab);
  }, [adminTab, isAdmin, loadAdminReports, session?.user?.id]);

  const reviewSuggestion = useCallback(
    async (row: VenueSuggestion, status: "approved" | "rejected") => {
      const reviewerId = session?.user?.id;
      if (!reviewerId) return;

      const doUpdate = async (note: string) => {
        try {
          const payload = {
            status,
            reviewed_at: new Date().toISOString(),
            reviewed_by: reviewerId,
            resolution_note: note,
          };

          const u = await supabase.from("venue_suggestions").update(payload).eq("id", row.id);

          if (u.error) {
            Alert.alert("Error", u.error.message);
            return;
          }

          await loadAdminReports(adminTab);
          await loadReports(reviewerId);
          await loadPendingCounts();

          Alert.alert("OK", `Marcado como ${statusLabel(status)}.`);
        } catch (e: any) {
          Alert.alert("Error", e?.message ?? "No se pudo actualizar el reporte.");
        }
      };

      const defaultNote =
        status === "approved"
          ? "Revisado: se acepta el reporte."
          : "Revisado: no se aplica ningún cambio.";

      if (Platform.OS === "ios" && (Alert as any).prompt) {
        (Alert as any).prompt(
          status === "approved" ? "Aprobar reporte" : "Rechazar reporte",
          "Nota de resolución (opcional).",
          [
            { text: "Cancelar", style: "cancel" },
            { text: "Guardar", onPress: (val: string) => void doUpdate((val ?? "").trim() || defaultNote) },
          ],
          "plain-text",
          defaultNote
        );
        return;
      }

      Alert.alert(
        status === "approved" ? "Aprobar reporte" : "Rechazar reporte",
        defaultNote,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar", onPress: () => void doUpdate(defaultNote) },
        ],
        { cancelable: true }
      );
    },
    [adminTab, loadAdminReports, loadPendingCounts, loadReports, session?.user?.id]
  );

  // -----------------------------
  // Mis propuestas (venue_proposals)
  // -----------------------------
  const loadMyProposals = useCallback(async (uid: string) => {
    setMyProposalsLoading(true);
    setMyProposalsError(null);

    try {
      // select("*") para no depender de si existe notes/message
      const r = await supabase
        .from("venue_proposals")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(20);

      if (r.error) {
        setMyProposals([]);
        setMyProposalsError(r.error.message);
        return;
      }

      setMyProposals((r.data ?? []) as any);
    } catch (e: any) {
      setMyProposals([]);
      setMyProposalsError(e?.message ?? "No se pudieron cargar las propuestas.");
    } finally {
      setMyProposalsLoading(false);
    }
  }, []);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setMyProposals([]);
      setMyProposalsError(null);
      setMyProposalsLoading(false);
      return;
    }
    void loadMyProposals(uid);
  }, [loadMyProposals, session?.user?.id]);

  // -----------------------------
  // Admin propuestas (venue_proposals)
  // -----------------------------
  const loadAdminProposals = useCallback(
    async (scope: "pending" | "reviewed") => {
      if (!session?.user?.id) return;
      if (!isAdmin) return;

      setAdminProposalsLoading(true);
      setAdminProposalsError(null);

      try {
        const q =
          scope === "pending"
            ? supabase
                .from("venue_proposals")
                .select("*")
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(50)
            : supabase
                .from("venue_proposals")
                .select("*")
                .in("status", ["approved", "rejected"])
                .order("reviewed_at", { ascending: false })
                .limit(50);

        const r = await q;

        if (r.error) {
          setAdminProposals([]);
          setAdminProposalsError(r.error.message);
          return;
        }

        const rows = (r.data ?? []) as any[];
        setAdminProposals(rows as any);

        // perfiles (para nombre)
        const uids = Array.from(new Set(rows.map((x) => x.user_id).filter(Boolean)));
        if (uids.length > 0) {
          const p = await supabase.from("profiles").select("id,display_name,username").in("id", uids);
          if (!p.error) {
            const map: Record<string, { display_name: string | null; username: string | null }> = {};
            for (const it of (p.data ?? []) as any[]) {
              map[it.id] = { display_name: it.display_name ?? null, username: it.username ?? null };
            }
            mergeProfiles(map);
          }
        }
      } catch (e: any) {
        setAdminProposals([]);
        setAdminProposalsError(e?.message ?? "No se pudieron cargar las propuestas (admin).");
      } finally {
        setAdminProposalsLoading(false);
      }
    },
    [isAdmin, mergeProfiles, session?.user?.id]
  );

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!isAdmin) return;
    void loadAdminProposals(adminProposalsTab);
  }, [adminProposalsTab, isAdmin, loadAdminProposals, session?.user?.id]);

  const reviewProposal = useCallback(
    async (row: VenueProposalRow, status: "approved" | "rejected") => {
      const reviewerId = session?.user?.id;
      if (!reviewerId) return;

      const doUpdate = async (note: string) => {
        try {
          await reviewVenueProposal(supabase, {
            id: row.id,
            status,
            reviewed_by: reviewerId,
            resolution_note: note,
          });

          await loadAdminProposals(adminProposalsTab);
          await loadMyProposals(reviewerId);
          await loadPendingCounts();

          Alert.alert("OK", `Marcado como ${statusLabel(status)}.`);
        } catch (e: any) {
          Alert.alert("Error", e?.message ?? "No se pudo actualizar la propuesta.");
        }
      };

      const defaultNote =
        status === "approved"
          ? "Revisado: se acepta la propuesta."
          : "Revisado: no se añade el local.";

      if (Platform.OS === "ios" && (Alert as any).prompt) {
        (Alert as any).prompt(
          status === "approved" ? "Aprobar propuesta" : "Rechazar propuesta",
          "Nota de resolución (opcional).",
          [
            { text: "Cancelar", style: "cancel" },
            { text: "Guardar", onPress: (val: string) => void doUpdate((val ?? "").trim() || defaultNote) },
          ],
          "plain-text",
          defaultNote
        );
        return;
      }

      Alert.alert(
        status === "approved" ? "Aprobar propuesta" : "Rechazar propuesta",
        defaultNote,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar", onPress: () => void doUpdate(defaultNote) },
        ],
        { cancelable: true }
      );
    },
    [adminProposalsTab, loadAdminProposals, loadMyProposals, loadPendingCounts, session?.user?.id]
  );

  const initial = (who ?? "U").trim().slice(0, 1).toUpperCase();
  const surface2 = (theme.colors as any).surface2 ?? theme.colors.surface;

  const totalPending = (pendingCounts.suggestions ?? 0) + (pendingCounts.proposals ?? 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
        <BrandLockup
          title={session ? (who ?? "Cuenta") : "Cuenta"}
          subtitle="Cuenta"
          iconSource={BRAND_A}
          style={{ marginBottom: theme.spacing.lg + 6 }}
        />

        {/* ✅ Aviso admin: revisiones pendientes */}
        {session && isAdmin && totalPending > 0 ? (
          <View style={{ marginBottom: theme.spacing.md }}>
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
                borderRadius: theme.radius.lg,
                padding: 12,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <TText weight="800">Revisiones pendientes</TText>
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
                  {/* FIX: TText no acepta 900 */}
                  <TText size={12} weight="800" muted>
                    {totalPending}
                  </TText>
                </View>
              </View>

              <TText muted size={12} style={{ marginTop: 6 }}>
                {pendingCounts.suggestions ? `${pendingCounts.suggestions} reportes` : "0 reportes"}
                {" · "}
                {pendingCounts.proposals ? `${pendingCounts.proposals} altas` : "0 altas"}
              </TText>
            </View>
          </View>
        ) : null}

        <TCard>
          {boot ? (
            <>
              <TText weight="800">Cargando…</TText>
              <TText muted style={{ marginTop: 6 }}>Comprobando tu sesión.</TText>
            </>
          ) : !session ? (
            <>
              <TText weight="800">No has iniciado sesión</TText>
              <TText muted style={{ marginTop: 6 }}>Entra con tu email y un código de acceso.</TText>

              <View style={{ marginTop: 12 }}>
                <TButton title="Iniciar sesión" onPress={goLogin} style={{ width: "100%" }} />
              </View>
            </>
          ) : (
            <>
              {/* Perfil */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 as any }}>
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: "rgba(201,163,92,0.25)",
                    backgroundColor: "rgba(201,163,92,0.08)",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  <TText weight="800" style={{ color: theme.colors.gold }}>
                    {initial}
                  </TText>
                </View>

                <View style={{ flex: 1 }}>
                  <TText weight="800">{who ?? "Usuario"}</TText>
                  <TText muted style={{ marginTop: 2 }}>
                    {profileLoading ? "Cargando perfil…" : session.user.email}
                  </TText>
                </View>
              </View>

              <View style={{ height: theme.spacing.md }} />

              {/* Meta */}
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                  paddingTop: theme.spacing.sm,
                  gap: 10 as any,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <TText muted>Estado</TText>
                  <TText weight="700">Conectado</TText>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <TText muted>ID</TText>
                  <TText muted numberOfLines={1} style={{ maxWidth: 190 }}>
                    {session.user.id}
                  </TText>
                </View>
              </View>

              {/* Acciones */}
              <View style={{ marginTop: 14, gap: 10 as any }}>
                <TButton
                  title="Cambiar cuenta"
                  variant="ghost"
                  onPress={() => void changeAccount()}
                  style={{ width: "100%" }}
                />
                <TButton title="Cerrar sesión" onPress={() => void logout()} style={{ width: "100%" }} />
              </View>

              <View style={{ marginTop: 14, gap: 8 as any }}>
                <TText muted>{t("account.language")}</TText>
                <View style={{ flexDirection: "row", gap: 10 as any }}>
                  <Pressable
                    onPress={() => void applyLanguage("es")}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: i18n.language === "es" ? theme.colors.surface2 : "transparent",
                    }}
                  >
                    <TText weight="700">{t("languages.es")}</TText>
                  </Pressable>
                  <Pressable
                    onPress={() => void applyLanguage("en")}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: i18n.language === "en" ? theme.colors.surface2 : "transparent",
                    }}
                  >
                    <TText weight="700">{t("languages.en")}</TText>
                  </Pressable>
                </View>
              </View>
            </>
          )}
        </TCard>

        {/* ✅ Mis reportes */}
        {session ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText weight="800">Mis reportes</TText>
              <TButton title="Recargar" variant="ghost" onPress={() => void loadReports(session.user.id)} />
            </View>

            <TCard style={{ marginTop: 10, backgroundColor: surface2 }}>
              {reportsLoading ? (
                <TText muted>Cargando reportes…</TText>
              ) : reportsError ? (
                <>
                  <TText style={{ color: theme.colors.danger }} weight="700">
                    No se pudieron cargar
                  </TText>
                  <TText muted style={{ marginTop: 6 }}>{reportsError}</TText>
                </>
              ) : reports.length === 0 ? (
                <>
                  <TText weight="700">Aún no has enviado reportes</TText>
                  <TText muted style={{ marginTop: 6 }}>
                    Desde la ficha de un local puedes “Reportar datos incorrectos”.
                  </TText>
                </>
              ) : (
                <View style={{ gap: 10 as any }}>
                  {reports.map((it) => {
                    const venueLabel = it.venue?.name
                      ? `${it.venue.name}${it.venue.city ? ` · ${it.venue.city}` : ""}`
                      : null;

                    return (
                      <View
                        key={it.id}
                        style={{
                          paddingVertical: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.colors.border,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <TText muted size={12}>
                            {fmtDateTime(it.created_at)}
                          </TText>
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
                            <TText size={12} weight="800" muted>
                              {statusLabel(it.status)}
                            </TText>
                          </View>
                        </View>

                        {venueLabel ? (
                          <TText weight="800" style={{ marginTop: 8 }}>
                            {venueLabel}
                          </TText>
                        ) : null}

                        <TText style={{ marginTop: 6 }}>{it.reason ? it.reason : "Reporte"}</TText>

                        {it.resolution_note ? <TText muted style={{ marginTop: 6 }}>{it.resolution_note}</TText> : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </TCard>
          </View>
        ) : null}

        {/* ✅ Moderación (Admin) - Reportes */}
        {session && isAdmin ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText weight="800">Moderación</TText>
              <TButton title="Recargar" variant="ghost" onPress={() => void loadAdminReports(adminTab)} />
            </View>

            {/* Tabs */}
            <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10 }}>
              <Pressable
                onPress={() => setAdminTab("pending")}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: "transparent",
                  opacity: adminTab === "pending" ? 1 : 0.55,
                }}
              >
                <TText weight="800" size={12} muted>
                  Pendientes
                </TText>
              </Pressable>

              <Pressable
                onPress={() => setAdminTab("reviewed")}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: "transparent",
                  opacity: adminTab === "reviewed" ? 1 : 0.55,
                }}
              >
                <TText weight="800" size={12} muted>
                  Revisados
                </TText>
              </Pressable>
            </View>

            <TCard style={{ marginTop: 10, backgroundColor: surface2 }}>
              {adminLoading ? (
                <TText muted>Cargando…</TText>
              ) : adminError ? (
                <>
                  <TText style={{ color: theme.colors.danger }} weight="700">
                    No se pudieron cargar
                  </TText>
                  <TText muted style={{ marginTop: 6 }}>{adminError}</TText>
                </>
              ) : adminRows.length === 0 ? (
                <TText muted>No hay reportes en esta bandeja.</TText>
              ) : (
                <View style={{ gap: 12 as any }}>
                  {adminRows.map((row) => {
                    const venueLabel = row.venue?.name
                      ? `${row.venue.name}${row.venue.city ? ` · ${row.venue.city}` : ""}`
                      : row.venue_id
                        ? `Local ${shortId(row.venue_id)}`
                        : "Local —";

                    /* <SECTION:ADMIN_SUGGESTIONS_OPEN> */
                    const openSuggestion = () => {
                      // Nota: expo-router types pueden no incluir esta ruta hasta regen.
                      router.push({ pathname: "/admin/suggestions/[id]" as any, params: { id: row.id } } as any);
                    };
                    /* </SECTION:ADMIN_SUGGESTIONS_OPEN> */

                    return (
                      <View
                        key={row.id}
                        style={{
                          paddingVertical: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.colors.border,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <TText muted size={12}>
                            {fmtDateTime(row.created_at)} · {adminUserLabel(row.user_id)}
                          </TText>

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
                            <TText size={12} weight="800" muted>
                              {statusLabel(row.status)}
                            </TText>
                          </View>
                        </View>

                        <TText weight="800" style={{ marginTop: 8 }}>
                          {venueLabel}
                        </TText>

                        <TText style={{ marginTop: 6 }}>{row.reason ?? "Reporte"}</TText>

                        {row.message ? <TText muted style={{ marginTop: 6 }}>{row.message}</TText> : null}

                        {/* <SECTION:ADMIN_SUGGESTIONS_ACTIONS> */}
                        {row.status === "pending" ? (
                          <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10, flexWrap: "wrap" }}>
                            <TButton title="Abrir" variant="ghost" onPress={openSuggestion} />
                            <TButton title="Aprobar" variant="ghost" onPress={() => void reviewSuggestion(row, "approved")} />
                            <TButton title="Rechazar" onPress={() => void reviewSuggestion(row, "rejected")} />
                          </View>
                        ) : (
                          <>
                            <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10, flexWrap: "wrap" }}>
                              <TButton title="Abrir" variant="ghost" onPress={openSuggestion} />
                            </View>
                            {row.resolution_note ? <TText muted style={{ marginTop: 8 }}>{row.resolution_note}</TText> : null}
                          </>
                        )}
                        {/* </SECTION:ADMIN_SUGGESTIONS_ACTIONS> */}
                      </View>
                    );
                  })}
                </View>
              )}
            </TCard>
          </View>
        ) : null}

        {/* ✅ Mis propuestas (altas) */}
        {session ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText weight="800">Mis propuestas</TText>
              <TButton title="Recargar" variant="ghost" onPress={() => void loadMyProposals(session.user.id)} />
            </View>

            <TCard style={{ marginTop: 10, backgroundColor: surface2 }}>
              {myProposalsLoading ? (
                <TText muted>Cargando propuestas…</TText>
              ) : myProposalsError ? (
                <>
                  <TText style={{ color: theme.colors.danger }} weight="700">
                    No se pudieron cargar
                  </TText>
                  <TText muted style={{ marginTop: 6 }}>{myProposalsError}</TText>
                </>
              ) : myProposals.length === 0 ? (
                <>
                  <TText weight="700">Aún no has enviado propuestas</TText>
                  <TText muted style={{ marginTop: 6 }}>
                    Desde “Proponer local” puedes sugerir un sitio que no esté en la base de datos.
                  </TText>
                </>
              ) : (
                <View style={{ gap: 10 as any }}>
                  {myProposals.map((it) => {
                    const title = (it.name ?? "Propuesta").trim();
                    const line2 = [it.city, it.address_text].filter(Boolean).join(" · ");
                    const note = (it.notes ?? it.message ?? "").trim();

                    return (
                      <View
                        key={it.id}
                        style={{
                          paddingVertical: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.colors.border,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <TText muted size={12}>
                            {fmtDateTime(it.created_at)}
                          </TText>
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
                            <TText size={12} weight="800" muted>
                              {statusLabel(it.status)}
                            </TText>
                          </View>
                        </View>

                        <TText weight="800" style={{ marginTop: 8 }}>
                          {title}
                        </TText>

                        {line2 ? <TText muted style={{ marginTop: 6 }}>{line2}</TText> : null}

                        {note ? <TText style={{ marginTop: 6 }}>{note}</TText> : null}

                        {it.resolution_note ? <TText muted style={{ marginTop: 6 }}>{it.resolution_note}</TText> : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </TCard>
          </View>
        ) : null}

        {/* ✅ Moderación · Altas (Admin) */}
        {session && isAdmin ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText weight="800">Moderación · Altas</TText>
              <TButton title="Recargar" variant="ghost" onPress={() => void loadAdminProposals(adminProposalsTab)} />
            </View>

            {/* Tabs */}
            <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10 }}>
              <Pressable
                onPress={() => setAdminProposalsTab("pending")}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: "transparent",
                  opacity: adminProposalsTab === "pending" ? 1 : 0.55,
                }}
              >
                <TText weight="800" size={12} muted>
                  Pendientes
                </TText>
              </Pressable>

              <Pressable
                onPress={() => setAdminProposalsTab("reviewed")}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: "transparent",
                  opacity: adminProposalsTab === "reviewed" ? 1 : 0.55,
                }}
              >
                <TText weight="800" size={12} muted>
                  Revisadas
                </TText>
              </Pressable>
            </View>

            <TCard style={{ marginTop: 10, backgroundColor: surface2 }}>
              {adminProposalsLoading ? (
                <TText muted>Cargando…</TText>
              ) : adminProposalsError ? (
                <>
                  <TText style={{ color: theme.colors.danger }} weight="700">
                    No se pudieron cargar
                  </TText>
                  <TText muted style={{ marginTop: 6 }}>{adminProposalsError}</TText>
                </>
              ) : adminProposals.length === 0 ? (
                <TText muted>No hay propuestas en esta bandeja.</TText>
              ) : (
                <View style={{ gap: 12 as any }}>
                  {/* <SECTION:ADMIN_PROPOSALS_LIST_ROWS> */}
                  {adminProposals.map((row) => {
                    const title = (row.name ?? "Propuesta").trim();
                    const line2 = [row.city, row.address_text].filter(Boolean).join(" · ");
                    const note = (row.notes ?? row.message ?? "").trim();

                    const open = () => {
                      // Ruta creada en Paso 1: app/admin/proposals/[id].tsx
                      router.push({ pathname: "/admin/proposals/[id]", params: { id: row.id } });
                    };

                    return (
                      <Pressable
                        key={row.id}
                        onPress={row.status === "pending" ? open : undefined}
                        style={{
                          paddingVertical: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.colors.border,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <TText muted size={12}>
                            {fmtDateTime(row.created_at)} · {adminUserLabel(row.user_id)}
                          </TText>

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
                            <TText size={12} weight="800" muted>
                              {statusLabel(row.status)}
                            </TText>
                          </View>
                        </View>

                        <TText weight="800" style={{ marginTop: 8 }}>
                          {title}
                        </TText>

                        {line2 ? <TText muted style={{ marginTop: 6 }}>{line2}</TText> : null}

                        {note ? <TText style={{ marginTop: 6 }}>{note}</TText> : null}

                        {row.status === "pending" ? (
                          <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10, flexWrap: "wrap" }}>
                            <TButton title="Abrir" variant="ghost" onPress={open} />
                            <TButton title="Aprobar" variant="ghost" onPress={() => void reviewProposal(row, "approved")} />
                            <TButton title="Rechazar" onPress={() => void reviewProposal(row, "rejected")} />
                          </View>
                        ) : row.resolution_note ? (
                          <TText muted style={{ marginTop: 8 }}>{row.resolution_note}</TText>
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {/* </SECTION:ADMIN_PROPOSALS_LIST_ROWS> */}
                </View>
              )}
            </TCard>
          </View>
        ) : null}

        {/* Micro tip */}
        <View style={{ marginTop: theme.spacing.md }}>
          <TText muted style={{ textAlign: "center" }}>
            Consejo: si cambias de cuenta, volverás a la pantalla de acceso.
          </TText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
