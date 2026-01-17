import { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { BrandLockup } from "../../src/ui/BrandLockup";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";

const BRAND_A = require("../../assets/branding/logo-a.png");

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
  venue?: { name: string | null; city: string | null } | null;
};

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

function statusLabel(s: VenueSuggestion["status"]) {
  if (s === "approved") return "Aprobado";
  if (s === "rejected") return "Rechazado";
  return "Pendiente";
}

export default function AccountScreen() {
  const router = useRouter();

  const [boot, setBoot] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // ✅ NUEVO: Mis reportes
  const [reports, setReports] = useState<VenueSuggestion[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);

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

  const loadReports = async (uid: string) => {
    setReportsLoading(true);
    setReportsError(null);
    try {
      // RLS: el usuario verá solo lo suyo; si eres admin, verás todos (pero aquí filtramos por tu uid igualmente).
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
  };

  useEffect(() => {
    let alive = true;

    (async () => {
      const uid = session?.user?.id;
      if (!uid) {
        if (!alive) return;
        setReports([]);
        setReportsError(null);
        setReportsLoading(false);
        return;
      }

      await loadReports(uid);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const who = useMemo(() => {
    if (!session) return null;
    return (
      profile?.display_name ||
      (profile?.username ? `@${profile.username}` : null) ||
      session.user.email ||
      "Usuario"
    );
  }, [session, profile]);

  const goLogin = () => router.replace("/auth");

  const changeAccount = async () => {
    try {
      // ✅ Cambiar cuenta = cerrar sesión + ir al login
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

  const initial = (who ?? "U").trim().slice(0, 1).toUpperCase();
  const surface2 = (theme.colors as any).surface2 ?? theme.colors.surface;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
        <BrandLockup
          title={session ? (who ?? "Cuenta") : "Cuenta"}
          subtitle="Cuenta"
          iconSource={BRAND_A}
          style={{ marginBottom: theme.spacing.lg + 6 }}
        />

        <TCard>
          {boot ? (
            <>
              <TText weight="800">Cargando…</TText>
              <TText muted style={{ marginTop: 6 }}>
                Comprobando tu sesión.
              </TText>
            </>
          ) : !session ? (
            <>
              <TText weight="800">No has iniciado sesión</TText>
              <TText muted style={{ marginTop: 6 }}>
                Entra con tu email y un código de acceso.
              </TText>

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
            </>
          )}
        </TCard>

        {/* ✅ NUEVO: Mis reportes */}
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
                  <TText muted style={{ marginTop: 6 }}>
                    {reportsError}
                  </TText>
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

                        {it.resolution_note ? (
                          <TText muted style={{ marginTop: 6 }}>
                            {it.resolution_note}
                          </TText>
                        ) : null}
                      </View>
                    );
                  })}
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
