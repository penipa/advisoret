// app/venue/suggest.tsx
// <SECTION:IMPORTS>
import { useMemo, useState } from "react";
import { SafeAreaView, ScrollView, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/theme";
import { TCard } from "../../src/ui/TCard";
import { TText } from "../../src/ui/TText";
import { TButton } from "../../src/ui/TButton";
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
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const nameClean = useMemo(() => clean(name), [name]);
  const cityClean = useMemo(() => clean(city), [city]);
  // </SECTION:STATE>

  // <SECTION:SUBMIT>
  const submit = async () => {
    if (saving) return;

    setErr(null);
    setOk(null);

    if (!nameClean) {
      setErr("Falta el nombre del local.");
      return;
    }

    if (mapsUrl.trim() && !isProbablyUrl(mapsUrl)) {
      setErr("El enlace de Google Maps no parece una URL válida (debe empezar por http/https).");
      return;
    }

    setSaving(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        router.push("/auth");
        return;
      }

      const userId = session.user.id;

      const { error } = await supabase.from("venue_proposals").insert({
        user_id: userId,
        name: nameClean,
        address_text: addressText.trim() ? clean(addressText) : null,
        city: cityClean || null,
        google_maps_url: mapsUrl.trim() ? mapsUrl.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
      });

      if (error) {
        setErr(error.message);
        return;
      }

      setOk("Propuesta enviada ✅ Gracias. La revisaremos pronto.");

      // reset suave
      setName("");
      setAddressText("");
      setCity("");
      setMapsUrl("");
      setNotes("");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };
  // </SECTION:SUBMIT>

  // <SECTION:RENDER>
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 140 }}>
        <TText size={theme.font.title} weight="800">
          Proponer local
        </TText>

        <TText muted style={{ marginTop: 8, lineHeight: 20 }}>
          ¿No encuentras un sitio? Envíanos los datos y lo añadiremos tras revisarlo.
        </TText>

        <TCard style={{ marginTop: theme.spacing.lg }}>
          <TText weight="700">Nombre *</TText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Bar Manolo"
            placeholderTextColor={theme.colors.textMuted}
            editable={!saving}
            style={{
              marginTop: 10,
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface2,
              opacity: saving ? 0.65 : 1,
            }}
          />

          <View style={{ height: theme.spacing.md }} />

          <TText weight="700">Dirección</TText>
          <TextInput
            value={addressText}
            onChangeText={setAddressText}
            placeholder="Calle, número…"
            placeholderTextColor={theme.colors.textMuted}
            editable={!saving}
            style={{
              marginTop: 10,
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface2,
              opacity: saving ? 0.65 : 1,
            }}
          />

          <View style={{ height: theme.spacing.md }} />

          <TText weight="700">Ciudad</TText>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="Valencia"
            placeholderTextColor={theme.colors.textMuted}
            editable={!saving}
            style={{
              marginTop: 10,
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface2,
              opacity: saving ? 0.65 : 1,
            }}
          />

          <View style={{ height: theme.spacing.md }} />

          <TText weight="700">Google Maps (opcional)</TText>
          <TextInput
            value={mapsUrl}
            onChangeText={setMapsUrl}
            placeholder="https://maps.google.com/…"
            placeholderTextColor={theme.colors.textMuted}
            editable={!saving}
            autoCapitalize="none"
            style={{
              marginTop: 10,
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface2,
              opacity: saving ? 0.65 : 1,
            }}
          />

          <View style={{ height: theme.spacing.md }} />

          <TText weight="700">Notas (opcional)</TText>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Qué pedirías, horarios, detalles…"
            placeholderTextColor={theme.colors.textMuted}
            editable={!saving}
            multiline
            style={{
              marginTop: 10,
              minHeight: 110,
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.colors.border,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface2,
              opacity: saving ? 0.65 : 1,
            }}
          />
        </TCard>

        {err ? (
          <TText style={{ color: theme.colors.danger, marginTop: theme.spacing.md }}>
            {err}
          </TText>
        ) : null}

        {ok ? (
          <TText weight="700" style={{ marginTop: theme.spacing.md }}>
            {ok}
          </TText>
        ) : null}

        <View style={{ marginTop: theme.spacing.lg }}>
          <TButton
            title={saving ? "Enviando..." : "Enviar propuesta"}
            onPress={() => void submit()}
            disabled={saving}
          />
          <View style={{ height: 10 }} />
          <TButton title="Volver" variant="ghost" onPress={() => router.back()} disabled={saving} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
  // </SECTION:RENDER>
}
// </SECTION:SCREEN>
