import { useEffect, useState } from "react";
import { SafeAreaView, View, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TText } from "../../src/ui/TText";
import { TCard } from "../../src/ui/TCard";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [status, setStatus] = useState("Procesando enlace…");

  useEffect(() => {
    const run = async () => {
      try {
        const code = typeof params.code === "string" ? params.code : null;
        const errDesc =
          typeof params.error_description === "string"
            ? params.error_description
            : typeof params.error === "string"
            ? params.error
            : null;

        if (errDesc) {
          setStatus("Error del enlace");
          Alert.alert("Error", errDesc);
          router.replace("/auth");
          return;
        }

        if (!code) {
          setStatus("Enlace incompleto");
          Alert.alert(
            "Enlace incompleto",
            "No encuentro el parámetro 'code'. Si estás en Expo Go, usa login con contraseña."
          );
          router.replace("/auth");
          return;
        }

        setStatus("Confirmando sesión…");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;

        setStatus("Listo ✅");
        router.replace("/(tabs)/explore");
      } catch (e: any) {
        setStatus("No se pudo iniciar sesión");
        Alert.alert(
          "No se pudo iniciar sesión",
          e?.message ?? "Prueba con contraseña (Plan B) o revisa los Redirect URLs en Supabase."
        );
        router.replace("/auth");
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ padding: theme.spacing.md }}>
        <TText size={theme.font.title} weight="800">
          Iniciando sesión
        </TText>

        <TCard style={{ marginTop: theme.spacing.md }}>
          <TText>{status}</TText>
          <TText muted style={{ marginTop: 8 }}>
            Si esta pantalla se queda aquí o vuelve a login, el enlace no está entrando como deep link en la app.
          </TText>
        </TCard>
      </View>
    </SafeAreaView>
  );
}
