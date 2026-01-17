import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: "",
        headerBackTitle: "Atrás",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="callback" options={{ headerShown: false }} />
      <Stack.Screen name="paste" options={{ headerShown: false }} />
    </Stack>
  );
}
