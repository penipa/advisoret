/* <SECTION:IMPORTS> */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Alert,
  Pressable,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

import { supabase } from "../../../src/lib/supabase";
import { theme } from "../../../src/theme";
import { TText } from "../../../src/ui/TText";
import { TCard } from "../../../src/ui/TCard";
import { TButton } from "../../../src/ui/TButton";
/* </SECTION:IMPORTS> */

/* <SECTION:TYPES> */
type VenueProposal = {
  id: string;
  user_id: string;
  name: string;
  address_text: string | null;
  city: string | null;
  google_maps_url: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  resolution_note: string | null;
  payload: any | null;
};

type VenueRow = {
  id: string;
  name: string;
  city: string;
  address_text: string | null;
  google_maps_url: string | null;
};

type ProfileMini = {
  id: string;
  display_name: string | null;
  username: string | null;
};
/* </SECTION:TYPES> */

/* <SECTION:UTILS> */
function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function norm(v?: string | null) {
  return (v ?? "").trim();
}

function mergePayload(prev: any | null, patch: Record<string, any>) {
  const base = prev && typeof prev === "object" ? prev : {};
  return { ...base, ...patch };
}

function parseNullableNumber(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function shortId(id: string | null | undefined) {
  const v = (id ?? "").trim();
  if (!v) return "—";
  return v.slice(0, 6);
}

/**
 * Extrae lat/lon si el URL contiene patrones típicos:
 * - ".../@38.123,-0.456,17z"
 * - "...?q=38.123,-0.456" / "?query=" / "?ll="
 */
function extractLatLon(urlRaw: string | null): { lat: number; lon: number } | null {
  const url = norm(urlRaw);
  if (!url) return null;

  const patterns: RegExp[] = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, // @lat,lon
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i, // ?q=lat,lon
  ];

  for (const re of patterns) {
    const m = url.match(re);
    if (m && m[1] && m[2]) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }
  }
  return null;
}

function profileLabel(p: ProfileMini | null | undefined): string | null {
  if (!p) return null;
  const dn = typeof p.display_name === "string" ? p.display_name.trim() : "";
  if (dn) return dn;
  const un = typeof p.username === "string" ? p.username.trim() : "";
  if (un) return un;
  return null;
}
/* </SECTION:UTILS> */

/* <SECTION:SCREEN> */
export default function AdminProposalDetailScreen() {
  /* <SECTION:PARAMS> */
  const params = useLocalSearchParams<{ id?: string }>();
  const id = (params.id ?? "").toString();
  /* </SECTION:PARAMS> */

  /* <SECTION:STATE> */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [proposal, setProposal] = useState<VenueProposal | null>(null);
  const [sessionUid, setSessionUid] = useState<string | null>(null);

  const [profilesById, setProfilesById] = useState<Record<string, ProfileMini>>({});

  // Form base
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [addressText, setAddressText] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [notes, setNotes] = useState("");

  // coords manuales (opcionales)
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");

  // Deduplicación
  const [dedupeLoading, setDedupeLoading] = useState(false);
  const [dedupeRan, setDedupeRan] = useState(false);
  const [dupeByGmaps, setDupeByGmaps] = useState<VenueRow | null>(null);
  const [dupesByNameCity, setDupesByNameCity] = useState<VenueRow[]>([]);
  const [dedupeError, setDedupeError] = useState<string | null>(null);
  /* </SECTION:STATE> */

  /* <SECTION:DERIVED> */
  const surface2 = useMemo(() => (theme.colors as any).surface2 ?? theme.colors.surface, []);
  const canEdit = useMemo(() => proposal?.status === "pending", [proposal?.status]);
  const canOpenGmaps = useMemo(() => norm(googleMapsUrl).length > 0, [googleMapsUrl]);

  const inputStyle = useMemo(
    () => ({
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: (theme.colors as any).surface2 ?? theme.colors.surface,
      color: theme.colors.text,
    }),
    []
  );

  const hasAnyDupes = useMemo(
    () => Boolean(dupeByGmaps || dupesByNameCity.length > 0),
    [dupeByGmaps, dupesByNameCity.length]
  );

  const proposerLabel = useMemo(() => {
    if (!proposal) return "—";
    if (sessionUid && proposal.user_id === sessionUid) return "Tú";
    const p = profilesById[proposal.user_id];
    return profileLabel(p) ?? `u:${shortId(proposal.user_id)}`;
  }, [proposal, sessionUid, profilesById]);

  const reviewerLabel = useMemo(() => {
    const rid = proposal?.reviewed_by ?? null;
    if (!rid) return "—";
    const p = profilesById[rid];
    return profileLabel(p) ?? `u:${shortId(rid)}`;
  }, [proposal?.reviewed_by, profilesById]);
  /* </SECTION:DERIVED> */

  /* <SECTION:LOAD> */
  const loadProfiles = useCallback(
    async (ids: string[]) => {
      const unique = Array.from(new Set(ids.filter(Boolean)));
      if (unique.length === 0) return;

      const missing = unique.filter((x) => !profilesById[x]);
      if (missing.length === 0) return;

      const r = await supabase.from("profiles").select("id,display_name,username").in("id", missing);
      if (r.error) return;

      const next: Record<string, ProfileMini> = { ...profilesById };
      for (const row of (r.data ?? []) as any[]) {
        if (!row?.id) continue;
        next[String(row.id)] = {
          id: String(row.id),
          display_name: row.display_name ?? null,
          username: row.username ?? null,
        };
      }
      setProfilesById(next);
    },
    [profilesById]
  );

  const load = useCallback(async () => {
    if (!id) {
      setProposal(null);
      setError("Falta el id de la propuesta.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const s = await supabase.auth.getSession();
      setSessionUid(s.data.session?.user?.id ?? null);

      const r = await supabase.from("venue_proposals").select("*").eq("id", id).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      if (!r.data) throw new Error("No se encontró la propuesta.");

      const row = r.data as any as VenueProposal;
      setProposal(row);

      setName(norm(row.name));
      setCity(norm(row.city));
      setAddressText(norm(row.address_text));
      setGoogleMapsUrl(norm(row.google_maps_url));
      setNotes(norm(row.notes));

      // Prefill coords si la URL trae @lat,lon (si no, vacíos)
      const coords = extractLatLon(row.google_maps_url);
      setLatText(coords ? String(coords.lat) : "");
      setLonText(coords ? String(coords.lon) : "");

      // Profiles: proposer + reviewer
      const ids: string[] = [row.user_id];
      if (row.reviewed_by) ids.push(row.reviewed_by);
      await loadProfiles(ids);

      // reset dedupe
      setDedupeRan(false);
      setDupeByGmaps(null);
      setDupesByNameCity([]);
      setDedupeError(null);
    } catch (e: any) {
      setProposal(null);
      setError(e?.message ?? "No se pudo cargar la propuesta.");
    } finally {
      setLoading(false);
    }
  }, [id, loadProfiles]);

  useEffect(() => {
    void load();
  }, [load]);
  /* </SECTION:LOAD> */

  /* <SECTION:ACTIONS> */
  const openGmaps = useCallback(async () => {
    const url = norm(googleMapsUrl);
    if (!url) return;

    const ok = await Linking.canOpenURL(url);
    if (!ok) return Alert.alert("No disponible", "No he podido abrir el enlace.");
    await Linking.openURL(url);
  }, [googleMapsUrl]);

  const save = useCallback(async () => {
    if (!proposal || !canEdit) return;

    const n = norm(name);
    if (!n) return Alert.alert("Falta nombre", "El nombre es obligatorio.");

    setSaving(true);
    try {
      const patch = {
        name: n,
        city: norm(city) || null,
        address_text: norm(addressText) || null,
        google_maps_url: norm(googleMapsUrl) || null,
        notes: norm(notes) || null,
      };

      const u = await supabase.from("venue_proposals").update(patch).eq("id", proposal.id);
      if (u.error) throw new Error(u.error.message);

      Alert.alert("OK", "Cambios guardados.");
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }, [proposal, canEdit, name, city, addressText, googleMapsUrl, notes, load]);

  const dedupe = useCallback(async () => {
    const n = norm(name);
    const c = norm(city);
    const g = norm(googleMapsUrl);

    setDedupeLoading(true);
    setDedupeRan(false);
    setDedupeError(null);
    setDupeByGmaps(null);
    setDupesByNameCity([]);

    try {
      if (g) {
        const byUrl = await supabase
          .from("venues")
          .select("id,name,city,address_text,google_maps_url")
          .eq("google_maps_url", g)
          .limit(3);

        if (byUrl.error) throw new Error(byUrl.error.message);
        const rows = (byUrl.data ?? []) as any as VenueRow[];
        if (rows.length > 0) setDupeByGmaps(rows[0]);
      }

      if (n && c) {
        const like = `%${n}%`;
        const byNameCity = await supabase
          .from("venues")
          .select("id,name,city,address_text,google_maps_url")
          .eq("city", c)
          .ilike("name", like)
          .order("name", { ascending: true })
          .limit(10);

        if (byNameCity.error) throw new Error(byNameCity.error.message);
        setDupesByNameCity(((byNameCity.data ?? []) as any) as VenueRow[]);
      }
    } catch (e: any) {
      setDedupeError(e?.message ?? "No se pudo ejecutar deduplicación.");
    } finally {
      setDedupeLoading(false);
      setDedupeRan(true);
    }
  }, [name, city, googleMapsUrl]);

  const stampReview = useCallback(
    async (status: "approved" | "rejected", resolutionNote: string, payloadPatch?: Record<string, any>) => {
      if (!proposal) return;

      const { data: sessionData } = await supabase.auth.getSession();
      const reviewerId = sessionData.session?.user?.id ?? null;
      if (!reviewerId) {
        Alert.alert("Sesión requerida", "Necesitas sesión activa para moderar.");
        return;
      }

      const patch: any = {
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
        resolution_note: resolutionNote,
      };

      if (payloadPatch) patch.payload = mergePayload(proposal.payload ?? null, payloadPatch);

      const u = await supabase.from("venue_proposals").update(patch).eq("id", proposal.id);
      if (u.error) throw new Error(u.error.message);
    },
    [proposal]
  );

  const reject = useCallback(async () => {
    if (!proposal || !canEdit) return;

    const defaultNote = "Revisado: no se añade el local.";

    Alert.alert(
      "Rechazar propuesta",
      defaultNote,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setReviewing(true);
              try {
                await stampReview("rejected", defaultNote);
                Alert.alert("OK", "Propuesta rechazada.");
                await load();
              } catch (e: any) {
                Alert.alert("Error", e?.message ?? "No se pudo rechazar.");
              } finally {
                setReviewing(false);
              }
            })();
          },
        },
      ],
      { cancelable: true }
    );
  }, [proposal, canEdit, stampReview, load]);

  const approveExisting = useCallback(
    async (venue: VenueRow) => {
      if (!proposal || !canEdit) return;

      const note = `Aprobado: ya existía el venue (${venue.id}). No se crea duplicado.`;

      Alert.alert(
        "Aprobar (ya existía)",
        note,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Confirmar",
            onPress: () => {
              void (async () => {
                setReviewing(true);
                try {
                  await stampReview("approved", note, { venue_id: venue.id, mode: "existing" });
                  Alert.alert("OK", "Marcado como aprobado (ya existía).");
                  await load();
                } catch (e: any) {
                  Alert.alert("Error", e?.message ?? "No se pudo aprobar como existente.");
                } finally {
                  setReviewing(false);
                }
              })();
            },
          },
        ],
        { cancelable: true }
      );
    },
    [proposal, canEdit, stampReview, load]
  );

  /* <SECTION:CREATE_VENUE_ACTION> */
  const createVenue = useCallback(
    async (force: boolean) => {
      if (!proposal || !canEdit) return;

      const s = await supabase.auth.getSession();
      const uid = s.data.session?.user?.id ?? null;
      if (!uid) return Alert.alert("Sesión requerida", "Necesitas sesión activa para crear el local.");

      const n = norm(name);
      const c = norm(city);
      if (!n || !c) return Alert.alert("Faltan datos", "Para crear el local necesitas al menos nombre y ciudad.");

      if (!force && hasAnyDupes) {
        Alert.alert(
          "Posible duplicado",
          "He encontrado coincidencias. Si realmente es el mismo local, usa “Aprobar (ya existía)”. Si no, usa “Crear igualmente”."
        );
        return;
      }

      const manualLat = parseNullableNumber(latText);
      const manualLon = parseNullableNumber(lonText);

      if (manualLat !== null && (Math.abs(manualLat) > 90 || !Number.isFinite(manualLat))) {
        Alert.alert("Latitud inválida", "Rango válido: -90 a 90.");
        return;
      }
      if (manualLon !== null && (Math.abs(manualLon) > 180 || !Number.isFinite(manualLon))) {
        Alert.alert("Longitud inválida", "Rango válido: -180 a 180.");
        return;
      }

      const parsed = extractLatLon(googleMapsUrl);
      const finalLat = manualLat ?? parsed?.lat ?? null;
      const finalLon = manualLon ?? parsed?.lon ?? null;

      const defaultNote = "Aprobada e insertada en venues.";

      Alert.alert(
        force ? "Crear igualmente" : "Crear local",
        defaultNote,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Crear",
            onPress: () => {
              void (async () => {
                setCreating(true);
                try {
                  const ins = await supabase
                    .from("venues")
                    .insert({
                      name: n,
                      city: c,
                      address_text: norm(addressText) || null,
                      google_maps_url: norm(googleMapsUrl) || null,
                      lat: finalLat,
                      lon: finalLon,
                      status: "active",
                      source: "proposal",
                      source_id: proposal.id,
                    })
                    .select("id")
                    .maybeSingle();

                  if (ins.error) throw new Error(ins.error.message);

                  const venueId = (ins.data as any)?.id as string | undefined;
                  if (!venueId) throw new Error("No se pudo obtener el id del venue creado.");

                  await stampReview("approved", `${defaultNote} (venue: ${venueId})`, { venue_id: venueId, mode: "created" });

                  Alert.alert("OK", "Local creado y propuesta aprobada.");
                  await load();
                } catch (e: any) {
                  Alert.alert("Error", e?.message ?? "No se pudo crear el local.");
                } finally {
                  setCreating(false);
                }
              })();
            },
          },
        ],
        { cancelable: true }
      );
    },
    [proposal, canEdit, name, city, addressText, googleMapsUrl, latText, lonText, hasAnyDupes, stampReview, load]
  );
  /* </SECTION:CREATE_VENUE_ACTION> */
  /* </SECTION:ACTIONS> */

  /* <SECTION:RENDER> */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 180 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <TText weight="800">Moderación · Alta de local</TText>
            <TButton title="Recargar" variant="ghost" onPress={() => void load()} />
          </View>

          {canEdit ? (
            <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10, flexWrap: "wrap" }}>
              <TButton title={saving ? "Guardando…" : "Guardar"} onPress={() => void save()} />
              <TButton title={dedupeLoading ? "Dedupe…" : "Deduplicar"} variant="ghost" onPress={() => void dedupe()} />
              <TButton title={creating ? "Creando…" : "Crear local"} onPress={() => void createVenue(false)} />
              <TButton title="Crear igualmente" variant="ghost" onPress={() => void createVenue(true)} />
              <TButton title={reviewing ? "Rechazando…" : "Rechazar"} onPress={() => void reject()} />
            </View>
          ) : null}

          <TCard style={{ marginTop: 12, backgroundColor: surface2 }}>
            {loading ? (
              <TText muted>Cargando…</TText>
            ) : error ? (
              <>
                <TText style={{ color: theme.colors.danger }} weight="800">
                  Error
                </TText>
                <TText muted style={{ marginTop: 6 }}>{error}</TText>

                <TText muted style={{ marginTop: 12 }} size={12}>
                  Propuesta ID:
                </TText>
                <TText style={{ marginTop: 4 }}>{id || "—"}</TText>
              </>
            ) : !proposal ? (
              <TText muted>No se encontró la propuesta.</TText>
            ) : (
              <>
                <TText muted size={12}>
                  {fmtDateTime(proposal.created_at)} · Propuesto por: {proposerLabel} · Estado: {proposal.status}
                </TText>

                <View style={{ marginTop: 14 }}>
                  <TText muted size={12}>Nombre</TText>
                  <TextInput editable={canEdit} value={name} onChangeText={setName} style={inputStyle as any} />
                </View>

                <View style={{ marginTop: 14 }}>
                  <TText muted size={12}>Ciudad</TText>
                  <TextInput editable={canEdit} value={city} onChangeText={setCity} style={inputStyle as any} />
                </View>

                <View style={{ marginTop: 14 }}>
                  <TText muted size={12}>Dirección</TText>
                  <TextInput editable={canEdit} value={addressText} onChangeText={setAddressText} style={inputStyle as any} />
                </View>

                <View style={{ marginTop: 14 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <TText muted size={12}>Google Maps URL</TText>
                    {canOpenGmaps ? (
                      <Pressable onPress={() => void openGmaps()}>
                        <TText weight="800" muted size={12}>
                          Abrir
                        </TText>
                      </Pressable>
                    ) : null}
                  </View>

                  <TextInput
                    editable={canEdit}
                    value={googleMapsUrl}
                    /* <SECTION:GMAPS_ONCHANGE_AUTOFILL_COORDS> */
                    onChangeText={(v) => {
                      setGoogleMapsUrl(v);

                      const hasManual = latText.trim().length > 0 || lonText.trim().length > 0;
                      if (hasManual) return;

                      const coords = extractLatLon(v);
                      if (coords) {
                        setLatText(String(coords.lat));
                        setLonText(String(coords.lon));
                      }
                    }}
                    /* </SECTION:GMAPS_ONCHANGE_AUTOFILL_COORDS> */
                    style={inputStyle as any}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                {canEdit ? (
                  <View style={{ marginTop: 14 }}>
                    <TText weight="800">Coordenadas</TText>
                    <TText muted size={12} style={{ marginTop: 6 }}>
                      Opcional. Si no las indicas, el venue se crea sin lat/lon.
                    </TText>

                    <View style={{ flexDirection: "row", gap: 10 as any, marginTop: 10 }}>
                      <View style={{ flex: 1 }}>
                        <TText muted size={12}>Latitud</TText>
                        <TextInput
                          editable={canEdit}
                          value={latText}
                          onChangeText={setLatText}
                          style={inputStyle as any}
                          placeholder="Ej: 38.6881"
                          placeholderTextColor={(theme.colors as any).muted ?? theme.colors.border}
                          keyboardType="numbers-and-punctuation"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <TText muted size={12}>Longitud</TText>
                        <TextInput
                          editable={canEdit}
                          value={lonText}
                          onChangeText={setLonText}
                          style={inputStyle as any}
                          placeholder="Ej: -0.1072"
                          placeholderTextColor={(theme.colors as any).muted ?? theme.colors.border}
                          keyboardType="numbers-and-punctuation"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>
                    </View>
                  </View>
                ) : null}

                <View style={{ marginTop: 14 }}>
                  <TText muted size={12}>Notas</TText>
                  <TextInput editable={canEdit} value={notes} onChangeText={setNotes} style={inputStyle as any} multiline={true} />
                </View>

                {!canEdit ? (
                  <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                    <TText weight="800">Revisión</TText>

                    <TText muted style={{ marginTop: 6 }}>
                      reviewed_at: {proposal.reviewed_at ? fmtDateTime(proposal.reviewed_at) : "—"}
                    </TText>
                    <TText muted style={{ marginTop: 4 }}>
                      reviewed_by: {reviewerLabel}
                    </TText>

                    {proposal.resolution_note ? <TText muted style={{ marginTop: 6 }}>{proposal.resolution_note}</TText> : null}
                  </View>
                ) : null}
              </>
            )}
          </TCard>

          {canEdit ? (
            <View style={{ marginTop: 12 }}>
              <TCard style={{ backgroundColor: surface2 }}>
                <TText weight="800">Deduplicación</TText>

                {dedupeLoading ? <TText muted style={{ marginTop: 8 }}>Buscando…</TText> : null}
                {dedupeError ? (
                  <TText style={{ color: theme.colors.danger, marginTop: 8 }} weight="700">
                    {dedupeError}
                  </TText>
                ) : null}

                {dedupeRan && !dedupeLoading && !dedupeError && !hasAnyDupes ? (
                  <TText muted style={{ marginTop: 8 }}>Dedupe ejecutada: no se han encontrado coincidencias.</TText>
                ) : null}

                {!dedupeRan && !dedupeLoading && !hasAnyDupes ? (
                  <TText muted style={{ marginTop: 8 }}>
                    Ejecuta “Deduplicar” para buscar locales existentes (por URL y por nombre+ciudad).
                  </TText>
                ) : null}

                {dupeByGmaps ? (
                  <View style={{ marginTop: 12 }}>
                    <TText weight="800">Coincidencia por Google Maps URL</TText>
                    <TText muted style={{ marginTop: 6 }}>
                      {dupeByGmaps.name} · {dupeByGmaps.city}
                    </TText>
                    {dupeByGmaps.address_text ? <TText muted>{dupeByGmaps.address_text}</TText> : null}

                    <View style={{ marginTop: 10 }}>
                      <TButton
                        title={reviewing ? "Aprobando…" : "Aprobar (ya existía)"}
                        variant="ghost"
                        onPress={() => void approveExisting(dupeByGmaps)}
                      />
                    </View>
                  </View>
                ) : null}

                {dupesByNameCity.length > 0 ? (
                  <View style={{ marginTop: 12 }}>
                    <TText weight="800">Coincidencias por nombre+ciudad</TText>
                    <View style={{ marginTop: 8, gap: 10 as any }}>
                      {dupesByNameCity.map((v) => (
                        <View key={v.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                          <TText weight="800">
                            {v.name} · {v.city}
                          </TText>
                          {v.address_text ? <TText muted style={{ marginTop: 4 }}>{v.address_text}</TText> : null}
                          {v.google_maps_url ? <TText muted style={{ marginTop: 4 }}>{v.google_maps_url}</TText> : null}

                          <View style={{ marginTop: 10 }}>
                            <TButton
                              title={reviewing ? "Aprobando…" : "Aprobar (ya existía)"}
                              variant="ghost"
                              onPress={() => void approveExisting(v)}
                            />
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </TCard>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
  /* </SECTION:RENDER> */
}
/* </SECTION:SCREEN> */
