import { Stack } from "expo-router";
import i18n from "../../src/i18n";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: "",
        headerBackTitle: i18n.t("common.back"),
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="callback" options={{ headerShown: false }} />
      <Stack.Screen name="paste" options={{ headerShown: false }} />
    </Stack>
  );
}
