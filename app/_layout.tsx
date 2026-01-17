import { useEffect, useMemo, useState } from "react";
import { ThemeProvider, DarkTheme } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "../src/lib/supabase";

// Advisoret brand tokens (ultra premium)
const BRAND = {
  bg: "#07090D", // near-black navy
  gold: "#C9A35C", // muted gold
  text: "#E6E9F0", // high-contrast light text
  border: "#121624", // subtle divider
};

const AdvisoretTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: BRAND.bg,
    card: BRAND.bg,
    text: BRAND.text,
    border: BRAND.border,
    primary: BRAND.gold,
  },
};

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const [boot, setBoot] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  // 1) Fuente de verdad de auth: getSession + onAuthStateChange en el root.
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

  const inAuth = useMemo(() => segments[0] === "auth", [segments]);

  // 2) Redirección estable: si no hay sesión, solo dejamos /auth.
  //    Si hay sesión, te sacamos de /auth y te llevamos a Tabs.
  useEffect(() => {
    if (boot) return;

    if (!session && !inAuth) {
      router.replace("/auth");
      return;
    }
    if (session && inAuth) {
      router.replace("/(tabs)");
    }
  }, [boot, session, inAuth, router]);

  return (
    <ThemeProvider value={AdvisoretTheme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: BRAND.bg },
          headerTintColor: BRAND.gold,
          headerTitleStyle: { color: BRAND.text },
          headerShadowVisible: true,
        }}
      >
        {/* Tabs */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        {/* Auth group (NO "auth/login") */}
        <Stack.Screen name="auth" options={{ headerShown: false }} />

        {/* Limpia títulos técnicos de pantallas dinámicas */}
        <Stack.Screen name="venue/[id]" options={{ title: "", headerBackTitle: "Atrás" }} />
        <Stack.Screen name="rate/[id]" options={{ title: "", headerBackTitle: "Atrás" }} />
        <Stack.Screen name="rankings/[scope]" options={{ title: "", headerBackTitle: "Atrás" }} />

        {/* Modal */}
        <Stack.Screen name="modal" options={{ presentation: "modal", title: "Advisoret" }} />
      </Stack>

      <StatusBar style="light" />
    </ThemeProvider>
  );
}
