// app/venue/suggest.tsx
// <SECTION:IMPORTS>
import { useMemo, useState } from "react";
import { SafeAreaView, ScrollView, TextInput, View, Platform } from "react-native";
import { useRouter } from "expo-router";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TCard } from "../../src/ui/TCard";
import { TText } from "../../src/ui/TText";
import { TButton } from "../../src/ui/TButton";
import { Stack } from "expo-router";

import { createVenueProposal } from "../../src/lib/venueProposals";
// </SECTION:IMPORTS>

// <SECTION:HELPERS>
function clean(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function isProbablyUrl(s: string) {
  const t = s.trim();
  if (!t) return false;
  return /^https?:\/\//i.test(t);
}
// </SECTION:HELPERS>

// <SECTION:SCREEN>
export default function SuggestVenueScreen() {
  // <SECTION:STATE>
  const router = useRouter();

  const [name, setName] = useState("");
  const [addressText, setAddressText] = useState("");
  const [city, setCity] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // </SECTION:STATE>

  // <SECTION:DERIVED>
  const canSubmit = useMemo(() => {
    const n = clean(name);
    const c = clean(city);
    if (!n || !c) return false;
    if (mapsUrl.trim() && !isProbablyUrl(mapsUrl)) return false;
    return !saving;
  }, [name, city, mapsUrl, saving]);
  // </SECTION:DERIVED>

  const inputStyle = useMemo(
    () => ({
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 6,
      color: theme.colors.text,
      fontSize: 16,
    }),
    []
  );

  const placeholderColor = theme.colors.textMuted;
  const cursorColor = theme.colors.primary;

  // <SECTION:SUBMIT>
  const submit = async () => {
    setError(null);

    const n = clean(name);
    const c = clean(city);
    const a = clean(addressText);
    const u = mapsUrl.trim();
    const no = notes.trim();

    if (!n || !c) {
      setError("Faltan campos: nombre y ciudad.");
      return;
    }
    if (u && !isProbablyUrl(u)) {
      setError("El enlace debe empezar por http(s)://");
      return;
    }

    try {
      setSaving(true);

      await createVenueProposal(supabase, {
        name: n,
        city: c,
        address_text: a || null,
        google_maps_url: u || null,
        notes: no || null,
        payload: { source: "venue/suggest", platform: Platform.OS },
      });

      router.back();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo enviar la propuesta.");
    } finally {
      setSaving(false);
    }
  };
  // </SECTION:SUBMIT>

  // <SECTION:RENDER>
  return (
    <>
      <Stack.Screen
        options={{
          title: "Proponer local",
          headerBackTitle: "Atrás",
        }}
      />

      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
          <TCard>
            <TText weight="800">Proponer local</TText>
            <TText muted style={{ marginTop: 6 }}>
              Si no existe en la app, envíanos los datos y lo revisaremos.
            </TText>

            <View style={{ height: theme.spacing.md }} />

            <TText weight="700" size={12} muted>
              Nombre *
            </TText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Ej: Bar Manolo"
              placeholderTextColor={placeholderColor}
              style={inputStyle}
              selectionColor={cursorColor}
              cursorColor={cursorColor}
            />

            <View style={{ height: 12 }} />

            <TText weight="700" size={12} muted>
              Ciudad *
            </TText>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="Ej: Valencia"
              placeholderTextColor={placeholderColor}
              style={inputStyle}
              selectionColor={cursorColor}
              cursorColor={cursorColor}
            />

            <View style={{ height: 12 }} />

            <TText weight="700" size={12} muted>
              Dirección (opcional)
            </TText>
            <TextInput
              value={addressText}
              onChangeText={setAddressText}
              placeholder="Calle, número…"
              placeholderTextColor={placeholderColor}
              style={inputStyle}
              selectionColor={cursorColor}
              cursorColor={cursorColor}
            />

            <View style={{ height: 12 }} />

            <TText weight="700" size={12} muted>
              Google Maps URL (opcional)
            </TText>
            <TextInput
              value={mapsUrl}
              onChangeText={setMapsUrl}
              placeholder="https://maps.app.goo.gl/…"
              placeholderTextColor={placeholderColor}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
              selectionColor={cursorColor}
              cursorColor={cursorColor}
            />

            <View style={{ height: 12 }} />

            <TText weight="700" size={12} muted>
              Notas (opcional)
            </TText>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Ej: mejor bocadillo de…"
              placeholderTextColor={placeholderColor}
              multiline
              style={{
                ...inputStyle,
                minHeight: 90,
                textAlignVertical: "top",
              }}
              selectionColor={cursorColor}
              cursorColor={cursorColor}
            />

            {error ? (
              <TText style={{ color: theme.colors.danger, marginTop: 12 }} weight="700">
                {error}
              </TText>
            ) : null}

            <View style={{ marginTop: 14 }}>
              <TButton title={saving ? "Enviando…" : "Enviar propuesta"} onPress={submit} disabled={!canSubmit} />
            </View>
          </TCard>
        </ScrollView>
      </SafeAreaView>
    </>
  );
  // </SECTION:RENDER>
}
// </SECTION:SCREEN>
