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
  if (s === "approved") return i18n.t("account.status.approved");
  if (s === "rejected") return i18n.t("account.status.rejected");
  return i18n.t("account.status.pending");
}

function normalizeResolutionNote(
  note: string | null | undefined,
  kind: "report" | "proposal"
): string | null {
  const raw = (note ?? "").trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase();

  if (kind === "report") {
    if (normalized === "revisado: se acepta el reporte.") {
      return i18n.t("account.resolution.reportApproved");
    }
    if (normalized === "revisado: no se aplica ningún cambio.") {
      return i18n.t("account.resolution.reportRejected");
    }
    return raw;
  }

  if (normalized === "revisado: se acepta la propuesta.") {
    return i18n.t("account.resolution.proposalApproved");
  }
  if (normalized === "revisado: no se añade el local.") {
    return i18n.t("account.resolution.proposalRejected");
  }
  if (normalized.startsWith("aprobada e insertada en venues.")) {
    return i18n.t("account.resolution.proposalApprovedShort");
  }

  return raw;
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
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportsTouched, setReportsTouched] = useState(false);

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
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [proposalsTouched, setProposalsTouched] = useState(false);

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
      t("account.userFallback")
    );
  }, [session, profile, t]);

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
        Alert.alert(t("common.error"), e?.message ?? t("account.errors.changeLanguage"));
      }
    },
    [session, t]
  );

  const changeAccount = async () => {
    try {
      await supabase.auth.signOut();
      router.replace("/auth");
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? t("account.errors.changeAccount"));
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      router.replace("/auth");
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? t("account.errors.logout"));
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
      setReportsError(e?.message ?? t("account.errors.loadReports"));
    } finally {
      setReportsLoading(false);
    }
  }, [t]);

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

  useEffect(() => {
    if (reportsTouched) return;
    if (reports.some((r) => r.status === "pending")) {
      setReportsOpen(true);
    }
  }, [reports, reportsTouched]);

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
        setAdminError(e?.message ?? t("account.errors.loadAdminReports"));
      } finally {
        setAdminLoading(false);
      }
    },
    [isAdmin, mergeProfiles, session?.user?.id, t]
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
            Alert.alert(t("common.error"), u.error.message);
            return;
          }

          await loadAdminReports(adminTab);
          await loadReports(reviewerId);
          await loadPendingCounts();

          Alert.alert(t("account.okTitle"), t("account.reviewSuggestion.markedAs", { status: statusLabel(status) }));
        } catch (e: any) {
          Alert.alert(t("common.error"), e?.message ?? t("account.errors.updateSuggestion"));
        }
      };

      const defaultNote =
        status === "approved"
          ? t("account.reviewSuggestion.defaultNoteApproved")
          : t("account.reviewSuggestion.defaultNoteRejected");

      if (Platform.OS === "ios" && (Alert as any).prompt) {
        (Alert as any).prompt(
          status === "approved" ? t("account.reviewSuggestion.approveTitle") : t("account.reviewSuggestion.rejectTitle"),
          t("account.reviewSuggestion.resolutionNoteOptional"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("common.save"), onPress: (val: string) => void doUpdate((val ?? "").trim() || defaultNote) },
          ],
          "plain-text",
          defaultNote
        );
        return;
      }

      Alert.alert(
        status === "approved" ? t("account.reviewSuggestion.approveTitle") : t("account.reviewSuggestion.rejectTitle"),
        defaultNote,
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.confirm"), onPress: () => void doUpdate(defaultNote) },
        ],
        { cancelable: true }
      );
    },
    [adminTab, loadAdminReports, loadPendingCounts, loadReports, session?.user?.id, t]
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
      setMyProposalsError(e?.message ?? t("account.errors.loadProposals"));
    } finally {
      setMyProposalsLoading(false);
    }
  }, [t]);

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

  useEffect(() => {
    if (proposalsTouched) return;
    if (myProposals.some((p) => p.status === "pending")) {
      setProposalsOpen(true);
    }
  }, [myProposals, proposalsTouched]);

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
        setAdminProposalsError(e?.message ?? t("account.errors.loadAdminProposals"));
      } finally {
        setAdminProposalsLoading(false);
      }
    },
    [isAdmin, mergeProfiles, session?.user?.id, t]
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

          Alert.alert(t("account.okTitle"), t("account.reviewProposal.markedAs", { status: statusLabel(status) }));
        } catch (e: any) {
          Alert.alert(t("common.error"), e?.message ?? t("account.errors.updateProposal"));
        }
      };

      const defaultNote =
        status === "approved"
          ? t("account.reviewProposal.defaultNoteApproved")
          : t("account.reviewProposal.defaultNoteRejected");

      if (Platform.OS === "ios" && (Alert as any).prompt) {
        (Alert as any).prompt(
          status === "approved" ? t("account.reviewProposal.approveTitle") : t("account.reviewProposal.rejectTitle"),
          t("account.reviewProposal.resolutionNoteOptional"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("common.save"), onPress: (val: string) => void doUpdate((val ?? "").trim() || defaultNote) },
          ],
          "plain-text",
          defaultNote
        );
        return;
      }

      Alert.alert(
        status === "approved" ? t("account.reviewProposal.approveTitle") : t("account.reviewProposal.rejectTitle"),
        defaultNote,
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.confirm"), onPress: () => void doUpdate(defaultNote) },
        ],
        { cancelable: true }
      );
    },
    [adminProposalsTab, loadAdminProposals, loadMyProposals, loadPendingCounts, session?.user?.id, t]
  );

  const initial = (who ?? "U").trim().slice(0, 1).toUpperCase();
  const surface2 = (theme.colors as any).surface2 ?? theme.colors.surface;

  const totalPending = (pendingCounts.suggestions ?? 0) + (pendingCounts.proposals ?? 0);
  const reportsPendingCount = reports.filter((r) => r.status === "pending").length;
  const proposalsPendingCount = myProposals.filter((p) => p.status === "pending").length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
        <BrandLockup
          title={session ? (who ?? t("account.title")) : t("account.title")}
          subtitle={t("account.subtitle")}
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
                <TText weight="800">{t("account.pendingReviews")}</TText>
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
                {t("account.pendingReports", { count: pendingCounts.suggestions ?? 0 })}
                {" · "}
                {t("account.pendingProposals", { count: pendingCounts.proposals ?? 0 })}
              </TText>
            </View>
          </View>
        ) : null}

        <TCard>
          {boot ? (
            <>
              <TText weight="800">{t("common.loading")}</TText>
              <TText muted style={{ marginTop: 6 }}>{t("account.checkingSession")}</TText>
            </>
          ) : !session ? (
            <>
              <TText weight="800">{t("account.notSignedIn")}</TText>
              <TText muted style={{ marginTop: 6 }}>{t("account.signInHint")}</TText>

              <View style={{ marginTop: 12 }}>
                <TButton title={t("account.signIn")} onPress={goLogin} style={{ width: "100%" }} />
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
                  <TText weight="800">{who ?? t("account.userFallback")}</TText>
                  <TText muted style={{ marginTop: 2 }}>
                    {profileLoading ? t("account.loadingProfile") : session.user.email}
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
                  <TText muted>{t("account.statusLabel")}</TText>
                  <TText weight="700">{t("account.connected")}</TText>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <TText muted>{t("account.idLabel")}</TText>
                  <TText muted numberOfLines={1} style={{ maxWidth: 190 }}>
                    {session.user.id}
                  </TText>
                </View>
              </View>

              {/* Acciones */}
              <View style={{ marginTop: 14, gap: 10 as any }}>
                <TButton
                  title={t("account.changeAccount")}
                  variant="ghost"
                  onPress={() => void changeAccount()}
                  style={{ width: "100%" }}
                />
                <TButton title={t("account.logout")} onPress={() => void logout()} style={{ width: "100%" }} />
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
              <Pressable
                onPress={() => {
                  setReportsTouched(true);
                  setReportsOpen((prev) => !prev);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 as any, flex: 1, marginRight: 8 }}
              >
                <TText weight="800">{t("account.myReports")}</TText>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: "transparent",
                  }}
                >
                  <TText size={12} weight="800" muted>
                    {reports.length}
                  </TText>
                </View>
                {reportsPendingCount > 0 ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
                    }}
                  >
                    <TText size={12} weight="800">
                      +{reportsPendingCount}
                    </TText>
                  </View>
                ) : null}
                <TText size={12} weight="800" muted>
                  {reportsOpen ? "▾" : "▸"}
                </TText>
              </Pressable>
              <TButton title={t("common.reload")} variant="ghost" onPress={() => void loadReports(session.user.id)} />
            </View>

            <TCard style={{ marginTop: 10, backgroundColor: surface2 }}>
              {reportsOpen ? (
                reportsLoading ? (
                  <TText muted>{t("account.loadingReports")}</TText>
                ) : reportsError ? (
                  <>
                    <TText style={{ color: theme.colors.danger }} weight="700">
                      {t("account.couldNotLoad")}
                    </TText>
                    <TText muted style={{ marginTop: 6 }}>{reportsError}</TText>
                  </>
                ) : reports.length === 0 ? (
                  <>
                    <TText weight="700">{t("account.noReportsYet")}</TText>
                    <TText muted style={{ marginTop: 6 }}>
                      {t("account.noReportsHint")}
                    </TText>
                  </>
                ) : (
                  <View style={{ gap: 10 as any }}>
                    {reports.map((it) => {
                      const venueLabel = it.venue?.name
                        ? `${it.venue.name}${it.venue.city ? ` · ${it.venue.city}` : ""}`
                        : null;
                      const resolutionNote = normalizeResolutionNote(it.resolution_note, "report");

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

                          <TText style={{ marginTop: 6 }}>{it.reason ? it.reason : t("account.reportFallback")}</TText>

                          {resolutionNote ? <TText muted style={{ marginTop: 6 }}>{resolutionNote}</TText> : null}
                        </View>
                      );
                    })}
                  </View>
                )
              ) : null}
            </TCard>
          </View>
        ) : null}

        {/* ✅ Moderación (Admin) - Reportes */}
        {session && isAdmin ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText weight="800">{t("account.moderation")}</TText>
              <TButton title={t("common.reload")} variant="ghost" onPress={() => void loadAdminReports(adminTab)} />
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
                  {t("account.pendingTab")}
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
                  {t("account.reviewedTab")}
                </TText>
              </Pressable>
            </View>

            <TCard style={{ marginTop: 10, backgroundColor: surface2 }}>
              {adminLoading ? (
                <TText muted>{t("common.loading")}</TText>
              ) : adminError ? (
                <>
                  <TText style={{ color: theme.colors.danger }} weight="700">
                    {t("account.couldNotLoad")}
                  </TText>
                  <TText muted style={{ marginTop: 6 }}>{adminError}</TText>
                </>
              ) : adminRows.length === 0 ? (
                <TText muted>{t("account.noReportsInTray")}</TText>
              ) : (
                <View style={{ gap: 12 as any }}>
                  {adminRows.map((row) => {
                    const venueLabel = row.venue?.name
                      ? `${row.venue.name}${row.venue.city ? ` · ${row.venue.city}` : ""}`
                      : row.venue_id
                        ? t("account.venueWithId", { id: shortId(row.venue_id) })
                        : t("account.venueFallback");

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

                        <TText style={{ marginTop: 6 }}>{row.reason ?? t("account.reportFallback")}</TText>

                        {row.message ? <TText muted style={{ marginTop: 6 }}>{row.message}</TText> : null}

                        {/* <SECTION:ADMIN_SUGGESTIONS_ACTIONS> */}
                        {row.status === "pending" ? (
                          <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10, flexWrap: "wrap" }}>
                            <TButton title={t("account.open")} variant="ghost" onPress={openSuggestion} />
                            <TButton title={t("account.approve")} variant="ghost" onPress={() => void reviewSuggestion(row, "approved")} />
                            <TButton title={t("account.reject")} onPress={() => void reviewSuggestion(row, "rejected")} />
                          </View>
                        ) : (
                          <>
                            <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10, flexWrap: "wrap" }}>
                              <TButton title={t("account.open")} variant="ghost" onPress={openSuggestion} />
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
              <Pressable
                onPress={() => {
                  setProposalsTouched(true);
                  setProposalsOpen((prev) => !prev);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 as any, flex: 1, marginRight: 8 }}
              >
                <TText weight="800">{t("account.myProposals")}</TText>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: "transparent",
                  }}
                >
                  <TText size={12} weight="800" muted>
                    {myProposals.length}
                  </TText>
                </View>
                {proposalsPendingCount > 0 ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
                    }}
                  >
                    <TText size={12} weight="800">
                      +{proposalsPendingCount}
                    </TText>
                  </View>
                ) : null}
                <TText size={12} weight="800" muted>
                  {proposalsOpen ? "▾" : "▸"}
                </TText>
              </Pressable>
              <TButton title={t("common.reload")} variant="ghost" onPress={() => void loadMyProposals(session.user.id)} />
            </View>

            <TCard style={{ marginTop: 10, backgroundColor: surface2 }}>
              {proposalsOpen ? (
                myProposalsLoading ? (
                  <TText muted>{t("account.loadingProposals")}</TText>
                ) : myProposalsError ? (
                  <>
                    <TText style={{ color: theme.colors.danger }} weight="700">
                      {t("account.couldNotLoad")}
                    </TText>
                    <TText muted style={{ marginTop: 6 }}>{myProposalsError}</TText>
                  </>
                ) : myProposals.length === 0 ? (
                  <>
                    <TText weight="700">{t("account.noProposalsYet")}</TText>
                    <TText muted style={{ marginTop: 6 }}>
                      {t("account.noProposalsHint")}
                    </TText>
                  </>
                ) : (
                  <View style={{ gap: 10 as any }}>
                    {myProposals.map((it) => {
                      const title = (it.name ?? t("account.proposalFallback")).trim();
                      const line2 = [it.city, it.address_text].filter(Boolean).join(" · ");
                      const note = (it.notes ?? it.message ?? "").trim();
                      const resolutionNote = normalizeResolutionNote(it.resolution_note, "proposal");

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

                          {resolutionNote ? <TText muted style={{ marginTop: 6 }}>{resolutionNote}</TText> : null}
                        </View>
                      );
                    })}
                  </View>
                )
              ) : null}
            </TCard>
          </View>
        ) : null}

        {/* ✅ Moderación · Altas (Admin) */}
        {session && isAdmin ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <TText weight="800">{t("account.moderationProposals")}</TText>
              <TButton title={t("common.reload")} variant="ghost" onPress={() => void loadAdminProposals(adminProposalsTab)} />
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
                  {t("account.pendingTab")}
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
                  {t("account.reviewedTabProposals")}
                </TText>
              </Pressable>
            </View>

            <TCard style={{ marginTop: 10, backgroundColor: surface2 }}>
              {adminProposalsLoading ? (
                <TText muted>{t("common.loading")}</TText>
              ) : adminProposalsError ? (
                <>
                  <TText style={{ color: theme.colors.danger }} weight="700">
                    {t("account.couldNotLoad")}
                  </TText>
                  <TText muted style={{ marginTop: 6 }}>{adminProposalsError}</TText>
                </>
              ) : adminProposals.length === 0 ? (
                <TText muted>{t("account.noProposalsInTray")}</TText>
              ) : (
                <View style={{ gap: 12 as any }}>
                  {/* <SECTION:ADMIN_PROPOSALS_LIST_ROWS> */}
                  {adminProposals.map((row) => {
                    const title = (row.name ?? t("account.proposalFallback")).trim();
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
                            <TButton title={t("account.open")} variant="ghost" onPress={open} />
                            <TButton title={t("account.approve")} variant="ghost" onPress={() => void reviewProposal(row, "approved")} />
                            <TButton title={t("account.reject")} onPress={() => void reviewProposal(row, "rejected")} />
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
            {t("account.changeAccountTip")}
          </TText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
