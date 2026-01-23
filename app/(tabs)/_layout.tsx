import React, { useEffect, useMemo, useState } from "react";
import { Tabs } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "../../components/haptic-tab";
import { IconSymbol } from "../../components/ui/icon-symbol";
import { supabase } from "../../src/lib/supabase";

// Advisoret brand tokens (ultra premium)
const BRAND = {
  bg: "#07090D",
  gold: "#C9A35C",
  muted: "#9AA3B2",
  border: "#121624",
};

// Tab bar sizing (safe + consistent)
const TAB_BAR = {
  height: Platform.select({ ios: 78, android: 70, default: 72 }),
  padTop: 8,
  padBottom: Platform.select({ ios: 18, android: 10, default: 12 }),
};

type Profile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

function shortLabel(s: string) {
  const trimmed = s.trim();
  if (trimmed.length <= 12) return trimmed;
  return trimmed.slice(0, 11) + "…";
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const extraBottom = Platform.OS === "android" ? insets.bottom : 0;

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(data.session ?? null);
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

      const p = await supabase
        .from("profiles")
        .select("id,display_name,username,avatar_url")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!alive) return;
      if (p.error) setProfile(null);
      else setProfile((p.data ?? null) as any);
    })();

    return () => {
      alive = false;
    };
  }, [session?.user?.id]);

  const accountTitle = useMemo(() => {
    if (!session) return "Cuenta";
    const label =
      profile?.display_name ||
      (profile?.username ? `@${profile.username}` : null) ||
      session.user.email ||
      "Cuenta";
    return shortLabel(label);
  }, [session, profile]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: BRAND.gold,
        tabBarInactiveTintColor: BRAND.muted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingHorizontal: 6,
        },
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: "rgba(7, 9, 13, 0.92)",
          borderTopColor: BRAND.border,
          borderTopWidth: 1,
          height: (TAB_BAR.height ?? 72) + extraBottom,
          paddingTop: TAB_BAR.padTop,
          paddingBottom: (TAB_BAR.padBottom ?? 12) + extraBottom,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inicio",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />

      {/* ✅ Explorar (listado infinito + filtros) */}
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explorar",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="magnifyingglass" color={color} />,
        }}
      />

      {/* ✅ Cuenta (tu nombre) */}
      <Tabs.Screen
        name="account"
        options={{
          title: accountTitle,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="person.crop.circle.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
