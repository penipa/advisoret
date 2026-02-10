import { useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  TextInput,
  View,
} from "react-native";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TCard } from "../../src/ui/TCard";
import { TText } from "../../src/ui/TText";
import { TButton } from "../../src/ui/TButton";
import { useTranslation } from "react-i18next";

const inputStyle = {
  backgroundColor: theme.colors.surface2 ?? theme.colors.surface,
  borderRadius: theme.radius.lg,
  borderWidth: 1,
  borderColor: theme.colors.border,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: theme.colors.text,
  fontSize: 16,
} as const;

export default function LoginScreen() {
  const { t } = useTranslation();
  const [method, setMethod] = useState<"code" | "password">("code");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const switchMethod = (m: "code" | "password") => {
    setMethod(m);
    setSent(false);
    setOtp("");
    // Nota: no borramos email para que sea cómodo.
  };

  const sendCode = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@")) {
      Alert.alert("Email", "Pon un email válido.");
      return;
    }

    setBusy(true);
    try {
      Keyboard.dismiss();

      // ✅ Con tus templates {{ .Token }} esto envía código.
      // shouldCreateUser=true => tus amigos se pueden dar de alta solos.
      const { error } = await supabase.auth.signInWithOtp({
        email: e,
        options: { shouldCreateUser: true },
      });

      if (error) throw error;

      setSent(true);
      Alert.alert("Código enviado", "Revisa tu correo e introduce el código.");
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "No se pudo enviar el código.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    const e = email.trim().toLowerCase();
    const code = otp.trim();

    if (!e || !e.includes("@")) {
      Alert.alert("Email", "Pon el mismo email al que pediste el código.");
      return;
    }
    if (code.length < 6) {
      Alert.alert("Código", "Pega el código del correo (normalmente 6–8 dígitos).");
      return;
    }

    setBusy(true);
    try {
      Keyboard.dismiss();

      // ✅ Supabase OTP por email suele validarse como type:"email".
      // Mantengo fallbacks por si tu proyecto lo está tratando como magiclink/signup.
      let attempt = await supabase.auth.verifyOtp({ email: e, token: code, type: "email" as any });
      let error = attempt.error ?? null;

      if (error) {
        const second = await supabase.auth.verifyOtp({ email: e, token: code, type: "magiclink" as any });
        error = second.error ?? null;
      }
      if (error) {
        const third = await supabase.auth.verifyOtp({ email: e, token: code, type: "signup" as any });
        error = third.error ?? null;
      }

      if (error) throw error;

      // ✅ NO navegamos aquí.
      // RootLayout escucha la sesión y te lleva a Tabs automáticamente.
    } catch (err: any) {
      Alert.alert(
        "No se pudo entrar",
        err?.message ??
          "Código inválido o caducado. Si pediste otro código, solo vale el último."
      );
    } finally {
      setBusy(false);
    }
  };

  const signInPassword = async () => {
    const e = email.trim().toLowerCase();
    const p = password;

    if (!e || !e.includes("@")) {
      Alert.alert("Email", "Pon un email válido.");
      return;
    }
    if (!p || p.length < 6) {
      Alert.alert("Contraseña", "Pon tu contraseña (mínimo 6 caracteres).");
      return;
    }

    setBusy(true);
    try {
      Keyboard.dismiss();

      const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
      if (error) throw error;

      // ✅ NO navegamos aquí.
      // RootLayout escucha la sesión y te lleva a Tabs automáticamente.
    } catch (err: any) {
      Alert.alert("No se pudo entrar", err?.message ?? "Email o contraseña incorrectos.");
    } finally {
      setBusy(false);
    }
  };

  const pillStyle = (active: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: active ? theme.colors.text : theme.colors.border,
    backgroundColor: active ? (theme.colors.surface2 ?? theme.colors.surface) : "transparent",
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <TText size={theme.font.title} weight="800">
              {t("auth.access")}
            </TText>
            <TText muted style={{ marginTop: 6 }}>
              {t("auth.methodHelp")}
            </TText>

            <View style={{ flexDirection: "row", marginTop: 12 }}>
              <Pressable
                onPress={() => switchMethod("code")}
                disabled={busy}
                style={{ ...pillStyle(method === "code"), marginRight: 10 }}
              >
                <TText weight={method === "code" ? "800" : "600"}>{t("auth.code")}</TText>
              </Pressable>

              <Pressable
                onPress={() => switchMethod("password")}
                disabled={busy}
                style={pillStyle(method === "password")}
              >
                <TText weight={method === "password" ? "800" : "600"}>{t("auth.password")}</TText>
              </Pressable>
            </View>

            <TCard style={{ marginTop: theme.spacing.md }}>
              <TText muted>{t("auth.email")}</TText>
              <View style={{ marginTop: 10 }}>
                <TextInput
                  style={inputStyle}
                  placeholder={t("auth.emailPlaceholder")}
                  placeholderTextColor={theme.colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!busy}
                  returnKeyType="done"
                />
              </View>

              {method === "password" ? (
                <>
                  <TText muted style={{ marginTop: 12 }}>
                    {t("auth.password")}
                  </TText>
                  <View style={{ marginTop: 10 }}>
                    <TextInput
                      style={inputStyle}
                      placeholder={t("auth.password")}
                      placeholderTextColor={theme.colors.textMuted}
                      value={password}
                      onChangeText={setPassword}
                      autoCapitalize="none"
                      editable={!busy}
                      returnKeyType="done"
                      secureTextEntry
                      textContentType="password"
                    />
                  </View>

                  <View style={{ marginTop: 12 }}>
                    <TButton
                      title={busy ? t("auth.entering") : t("auth.enter")}
                      onPress={() => void signInPassword()}
                      disabled={busy}
                    />
                  </View>

                  <View style={{ marginTop: 12 }}>
                    <TText muted size={theme.font.small}>
                      Consejo: para TestFlight/App Review usa una cuenta demo con contraseña (la creas en Supabase).
                    </TText>
                  </View>
                </>
              ) : (
                <>
                  <View style={{ marginTop: 12 }}>
                    <TButton
                      title={busy ? t("auth.sending") : t("auth.sendCode")}
                      onPress={() => void sendCode()}
                      disabled={busy}
                    />
                  </View>

                  {sent && (
                    <>
                      <TText weight="700" style={{ marginTop: 18 }}>
                        {t("auth.code")}
                      </TText>
                      <TText muted style={{ marginTop: 6 }}>
                        Pega el código (6–8 dígitos). Si pides otro, solo vale el último.
                      </TText>

                      <View style={{ marginTop: 10 }}>
                        <TextInput
                          style={inputStyle}
                          placeholder={t("auth.code")}
                          placeholderTextColor={theme.colors.textMuted}
                          value={otp}
                          onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 12))}
                          keyboardType="number-pad"
                          editable={!busy}
                          returnKeyType="done"
                        />
                      </View>

                      <View style={{ marginTop: 12 }}>
                        <TButton
                          title={busy ? t("auth.entering") : t("auth.enter")}
                          onPress={() => void verifyCode()}
                          disabled={busy}
                        />
                      </View>
                    </>
                  )}
                </>
              )}
            </TCard>

            <View style={{ marginTop: 14 }}>
                <TText muted size={theme.font.small}>
                  {t("auth.noteExpo")}
                </TText>
              </View>
          </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
