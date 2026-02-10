import { useState } from "react";
import {
  SafeAreaView,
  View,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";
import { TButton } from "../../src/ui/TButton";
import { useTranslation } from "react-i18next";

function clean(s: string) {
  return s.trim().replace(/\s+/g, "");
}

function parseLink(raw: string): { token?: string; type?: string } {
  const text = clean(raw);
  const url = new URL(text);

  const token =
    url.searchParams.get("token_hash") ??
    url.searchParams.get("token") ??
    undefined;

  const type = url.searchParams.get("type") ?? "magiclink";

  return { token, type };
}

export default function PasteLinkScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [raw, setRaw] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const verifyFromLink = async () => {
    setErr(null);
    setMsg(null);

    let token: string | undefined;
    let type: string | undefined;

    try {
      const parsed = parseLink(raw);
      token = parsed.token;
      type = parsed.type ?? "magiclink";
    } catch {
      setErr(t("auth.paste.errors.invalidUrl"));
      return;
    }

    if (!token) {
      setErr(t("auth.paste.errors.tokenMissing"));
      return;
    }

    setLoading(true);

    const attempt1 = await supabase.auth.verifyOtp({
      token_hash: token,
      type: (type as any) ?? "magiclink",
    });

    if (!attempt1.error) {
      setLoading(false);
      setMsg(t("auth.paste.success.sessionStarted"));
      router.replace("/(tabs)");
      return;
    }

    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) {
      setLoading(false);
      setErr(t("auth.paste.errors.emailRequiredFallback"));
      return;
    }

    const attempt2 = await supabase.auth.verifyOtp({
      email: e,
      token,
      type: "email",
    } as any);

    setLoading(false);

    if (attempt2.error) {
      setErr(t("auth.paste.errors.verifyFailed", { message: attempt1.error.message }));
      return;
    }

    setMsg(t("auth.paste.success.sessionStarted"));
    router.replace("/(tabs)");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: theme.spacing.md,
            paddingTop: theme.spacing.xl,
            paddingBottom: 160, // espacio para que el botón no quede tapado
          }}
        >
          <TText size={theme.font.title} weight="800">
            {t("auth.pasteTitle")}
          </TText>

          <TText muted style={{ marginTop: 8 }}>
            {t("auth.pasteHelp")}
          </TText>

          <Pressable
            onPress={() => Keyboard.dismiss()}
            style={{ alignSelf: "flex-end", marginTop: theme.spacing.sm }}
          >
            <TText muted>{t("auth.hideKeyboard")}</TText>
          </Pressable>

          <TCard style={{ marginTop: theme.spacing.md }}>
            <TText weight="700">{t("auth.email")}</TText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder={t("auth.emailPlaceholder")}
              placeholderTextColor={theme.colors.textMuted}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
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

            <View style={{ height: theme.spacing.md }} />

            <TText weight="700">{t("auth.paste.linkLabel")}</TText>
            <TextInput
              value={raw}
              onChangeText={setRaw}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("auth.paste.linkPlaceholder")}
              placeholderTextColor={theme.colors.textMuted}
              multiline
              textAlignVertical="top"
              style={{
                marginTop: 10,
                minHeight: 140,
                paddingVertical: 12,
                paddingHorizontal: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
                color: theme.colors.text,
                backgroundColor: theme.colors.surface2,
              }}
            />

            <View style={{ marginTop: theme.spacing.md }}>
              <TButton
                title={loading ? t("auth.validating") : t("auth.validateAndEnter")}
                onPress={loading ? undefined : verifyFromLink}
              />
            </View>

            {err && (
              <TText style={{ color: theme.colors.danger, marginTop: theme.spacing.md }}>
                {err}
              </TText>
            )}

            {msg && <TText style={{ marginTop: theme.spacing.md }}>{msg}</TText>}
          </TCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
