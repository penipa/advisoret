import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { supabase } from "../src/lib/supabase";
import { theme } from "../src/theme";
import { TButton } from "../src/ui/TButton";
import { TCard } from "../src/ui/TCard";
import { TText } from "../src/ui/TText";

const CONFIRM_WORDS = ["DELETE", "ELIMINAR"] as const;

export default function AccountDeleteScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const canDelete = useMemo(() => {
    const normalized = confirmText.trim().toUpperCase();
    return acknowledged && CONFIRM_WORDS.includes(normalized as (typeof CONFIRM_WORDS)[number]);
  }, [acknowledged, confirmText]);

  const handleDelete = async () => {
    if (!canDelete || busy) return;

    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error(t("account.deleteFlow.errors.noSession"));

      const { error } = await supabase.functions.invoke("delete-account", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (error) throw error;

      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // Si el usuario ya no existe en Auth, seguimos limpiando la navegación local.
      }

      Alert.alert(t("account.deleteFlow.successTitle"), t("account.deleteFlow.successMessage"), [
        {
          text: t("common.ok"),
          onPress: () => router.replace("/auth"),
        },
      ]);
    } catch (e: any) {
      Alert.alert(
        t("account.deleteFlow.errorTitle"),
        e?.message ?? t("account.deleteFlow.errors.unknown")
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen
        options={{
          title: t("account.deleteAccount"),
          headerBackTitle: t("common.back"),
        }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <TText size={theme.font.title} weight="800">
            {t("account.deleteFlow.title")}
          </TText>
          <TText muted style={{ marginTop: 6 }}>
            {t("account.deleteFlow.subtitle")}
          </TText>

          <TCard style={{ marginTop: theme.spacing.md }}>
            <TText weight="800">{t("account.deleteFlow.whatDeletesTitle")}</TText>
            <TText muted style={{ marginTop: 8 }}>
              {t("account.deleteFlow.whatDeletesBody")}
            </TText>
          </TCard>

          <TCard style={{ marginTop: theme.spacing.md }}>
            <TText weight="800">{t("account.deleteFlow.whatKeepsTitle")}</TText>
            <TText muted style={{ marginTop: 8 }}>
              {t("account.deleteFlow.whatKeepsBody")}
            </TText>
          </TCard>

          <TCard style={{ marginTop: theme.spacing.md }}>
            <Pressable
              onPress={() => setAcknowledged((prev) => !prev)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10 as any,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: acknowledged ? theme.colors.primary : "transparent",
                }}
              >
                {acknowledged ? (
                  <TText weight="800" style={{ color: "#062014" }}>
                    ✓
                  </TText>
                ) : null}
              </View>

              <TText style={{ flex: 1 }}>{t("account.deleteFlow.acknowledge")}</TText>
            </Pressable>

            <TText muted style={{ marginTop: 16 }}>
              {t("account.deleteFlow.confirmLabel", { words: CONFIRM_WORDS.join(" / ") })}
            </TText>

            <TextInput
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              placeholder={CONFIRM_WORDS[0]}
              placeholderTextColor={theme.colors.textMuted}
              style={{
                marginTop: 10,
                paddingVertical: 12,
                paddingHorizontal: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
                color: theme.colors.text,
                backgroundColor: theme.colors.surface2,
              }}
            />

            <View style={{ marginTop: 16, gap: 10 as any }}>
              <TButton
                title={busy ? t("account.deleteFlow.deleting") : t("account.deleteFlow.confirmButton")}
                onPress={() => void handleDelete()}
                disabled={!canDelete || busy}
                style={{ width: "100%" }}
              />
              <TButton
                title={t("common.cancel")}
                variant="ghost"
                onPress={() => router.back()}
                disabled={busy}
                style={{ width: "100%" }}
              />
            </View>
          </TCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
