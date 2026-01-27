// app/admin/suggestions/[id].tsx
// <SECTION:IMPORTS>
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { supabase } from "../../../src/lib/supabase";
import { theme } from "../../../src/theme";
import { TCard } from "../../../src/ui/TCard";
import { TText } from "../../../src/ui/TText";
import { TButton } from "../../../src/ui/TButton";
// </SECTION:IMPORTS>

// <SECTION:CONSTANTS>
const ADMIN_EMAIL_FALLBACK = "pablo_penichet@yahoo.es";
// </SECTION:CONSTANTS>

// <SECTION:TYPES>
type SuggestionStatus = "pending" | "approved" | "rejected";

type VenueSuggestionRow = {
  id: string;
  created_at: string;
  updated_at: string | null;
  venue_id: string | null;
  user_id: string | null;
  kind: string | null;
  reason: string | null;
  message: string | null;
  payload: any;
  status: SuggestionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution_note: string | null;
  address_text: string | null;
  city: string | null;
  google_maps_url: string | null;
  notes: string | null;
};

type VenueRow = {
  id: string;
  name: string | null;
  city: string | null;
  address_text: string | null;
  google_maps_url: string | null;
  lat: number | null;
  lon: number | null;
  status: string | null;
};

type Profile = {
  id: string;
  display_name: string | null;
  username: string | null;
};
// </SECTION:TYPES>

// <SECTION:HELPERS>
function fmtDateTime(iso?: string | null) {
  const v = (iso ?? "").trim();
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("es-ES", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return v;
  }
}

function shortId(id?: string | null) {
  const v = (id ?? "").trim();
  if (!v) return "—";
  return v.slice(0, 6);
}

function parseLatLonFromGoogleMapsUrl(url: string): { lat: number; lon: number } | null {
  const u = (url ?? "").trim();
  if (!u) return null;

  // patrón @lat,lon
  const m1 = u.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (m1) {
    const lat = Number(m1[1]);
    const lon = Number(m1[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }

  // patrón ?q=lat,lon
  const m2 = u.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (m2) {
    const lat = Number(m2[1]);
    const lon = Number(m2[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }

  return null;
}

function clean(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function showStatus(s: SuggestionStatus) {
  if (s === "approved") return "Aprobado";
  if (s === "rejected") return "Rechazado";
  return "Pendiente";
}
// </SECTION:HELPERS>

// <SECTION:UI_HELPERS>
function Field(props: {
  label: string;
  value: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  editable?: boolean;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  keyboardType?: "default" | "numeric" | "email-address" | "phone-pad" | "url";
}) {
  const {
    label,
    value,
    onChangeText,
    placeholder,
    editable = true,
    multiline,
    autoCapitalize,
    autoCorrect,
    keyboardType,
  } = props;

  return (
    <View style={{ marginTop: 12 }}>
      <TText weight="700" size={12} muted>
        {label}
      </TText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#999"
        editable={editable}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        keyboardType={keyboardType}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          paddingVertical: 10,
          marginTop: 6,
          minHeight: multiline ? 90 : undefined,
          textAlignVertical: multiline ? "top" : "auto",
          color: theme.colors.text, // ✅ FIX: texto en negro (según theme)
        }}
      />
    </View>
  );
}
// </SECTION:UI_HELPERS>


// <SECTION:SCREEN>
export default function AdminSuggestionDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = (params?.id ?? "").toString();

  // <SECTION:STATE_AUTH>
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // </SECTION:STATE_AUTH>

  // <SECTION:STATE_DATA>
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [row, setRow] = useState<VenueSuggestionRow | null>(null);
  const [venue, setVenue] = useState<VenueRow | null>(null);

  const [proposedCity, setProposedCity] = useState("");
  const [proposedAddress, setProposedAddress] = useState("");
  const [proposedMapsUrl, setProposedMapsUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");

  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [coordsManual, setCoordsManual] = useState(false);

  const [proposedBy, setProposedBy] = useState<string>("u:—");
  const [reviewedByLabel, setReviewedByLabel] = useState<string>("—");
  // </SECTION:STATE_DATA>

  // <SECTION:LOAD_AUTH>
  const loadAuth = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id ?? null;
    const email = (data.session?.user?.email ?? "").toLowerCase().trim() || null;

    setSessionUserId(uid);
    setSessionEmail(email);

    if (!uid) {
      setIsAdmin(false);
      return;
    }

    const emailFallback = email === ADMIN_EMAIL_FALLBACK;

    try {
      const p = await supabase.from("profiles").select("is_admin").eq("id", uid).maybeSingle();
      if (p.error || !p.data) {
        setIsAdmin(emailFallback);
        return;
      }
      const flag = (p.data as any)?.is_admin;
      setIsAdmin(Boolean(flag) || emailFallback);
    } catch {
      setIsAdmin(emailFallback);
    }
  }, []);
  // </SECTION:LOAD_AUTH>

  // <SECTION:LOAD_DATA>
  const loadData = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    try {
      const s = await supabase.from("venue_suggestions").select("*").eq("id", id).maybeSingle();
      if (s.error) throw s.error;

      const suggestion = (s.data ?? null) as any as VenueSuggestionRow;
      setRow(suggestion);

      // hydrate editable fields from suggestion
      setProposedCity((suggestion.city ?? "").toString());
      setProposedAddress((suggestion.address_text ?? "").toString());
      setProposedMapsUrl((suggestion.google_maps_url ?? "").toString());
      setNotes((suggestion.notes ?? "").toString());
      setResolutionNote((suggestion.resolution_note ?? "").toString());

      // cargar venue
      if (suggestion.venue_id) {
        const v = await supabase
          .from("venues")
          .select("id,name,city,address_text,google_maps_url,lat,lon,status")
          .eq("id", suggestion.venue_id)
          .maybeSingle();
        if (!v.error) {
          setVenue((v.data ?? null) as any);
          // inicializar coords en inputs desde venue
          const lat = (v.data as any)?.lat;
          const lon = (v.data as any)?.lon;
          setLatText(lat === null || lat === undefined ? "" : String(lat));
          setLonText(lon === null || lon === undefined ? "" : String(lon));
        }
      } else {
        setVenue(null);
        setLatText("");
        setLonText("");
      }

      // propuesto por / revisado por
      if (suggestion.user_id) {
        const p = await supabase
          .from("profiles")
          .select("id,display_name,username")
          .eq("id", suggestion.user_id)
          .maybeSingle();
        if (!p.error && p.data) {
          const label = (p.data.display_name ?? (p.data.username ? `@${p.data.username}` : "")).trim();
          setProposedBy(label || `u:${shortId(suggestion.user_id)}`);
        } else {
          setProposedBy(`u:${shortId(suggestion.user_id)}`);
        }
      } else {
        setProposedBy("u:—");
      }

      if (suggestion.reviewed_by) {
        const r = await supabase
          .from("profiles")
          .select("id,display_name,username")
          .eq("id", suggestion.reviewed_by)
          .maybeSingle();
        if (!r.error && r.data) {
          const label = (r.data.display_name ?? (r.data.username ? `@${r.data.username}` : "")).trim();
          setReviewedByLabel(label || `u:${shortId(suggestion.reviewed_by)}`);
        } else {
          setReviewedByLabel(`u:${shortId(suggestion.reviewed_by)}`);
        }
      } else {
        setReviewedByLabel("—");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo cargar el suggestion.");
      setRow(null);
      setVenue(null);
    } finally {
      setLoading(false);
    }
  }, [id]);
  // </SECTION:LOAD_DATA>

  // <SECTION:EFFECTS>
  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  // auto-relleno de coords si pegas URL y no has tocado coords manualmente
  useEffect(() => {
    if (coordsManual) return;
    const parsed = parseLatLonFromGoogleMapsUrl(proposedMapsUrl);
    if (!parsed) return;
    setLatText((prev) => (prev.trim() ? prev : String(parsed.lat)));
    setLonText((prev) => (prev.trim() ? prev : String(parsed.lon)));
  }, [coordsManual, proposedMapsUrl]);
  // </SECTION:EFFECTS>

  // <SECTION:DERIVED>
  const canApply = useMemo(() => {
    if (!row?.venue_id) return false;
    if (!isAdmin) return false;
    if (saving) return false;
    return true;
  }, [isAdmin, row?.venue_id, saving]);

  const canSave = useMemo(() => {
    if (!isAdmin) return false;
    if (saving) return false;
    return true;
  }, [isAdmin, saving]);
  // </SECTION:DERIVED>

  // <SECTION:ACTIONS>
  const saveSuggestion = useCallback(async () => {
    if (!row?.id) return;
    if (!isAdmin) return;

    try {
      setSaving(true);

      const payload: Partial<VenueSuggestionRow> = {
        city: clean(proposedCity) || null,
        address_text: clean(proposedAddress) || null,
        google_maps_url: clean(proposedMapsUrl) || null,
        notes: notes.trim() || null,
        resolution_note: resolutionNote.trim() || null,
      };

      const u = await supabase.from("venue_suggestions").update(payload).eq("id", row.id);
      if (u.error) throw u.error;

      Alert.alert("OK", "Suggestion guardado.");
      await loadData();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo guardar el suggestion.");
    } finally {
      setSaving(false);
    }
  }, [isAdmin, loadData, notes, proposedAddress, proposedCity, proposedMapsUrl, resolutionNote, row?.id]);

  const applyToVenue = useCallback(async () => {
    if (!row?.venue_id) {
      Alert.alert("Falta venue_id", "Este suggestion no está ligado a ningún local.");
      return;
    }
    if (!isAdmin) return;

    try {
      setSaving(true);

      // merge: si el campo está vacío, no lo pisamos
      const nextCity = clean(proposedCity);
      const nextAddr = clean(proposedAddress);
      const nextUrl = clean(proposedMapsUrl);

      const patch: any = {};
      if (nextCity) patch.city = nextCity;
      if (nextAddr) patch.address_text = nextAddr;
      if (nextUrl) patch.google_maps_url = nextUrl;

      const lat = Number(latText.trim());
      const lon = Number(lonText.trim());
      if (latText.trim() && Number.isFinite(lat)) patch.lat = lat;
      if (lonText.trim() && Number.isFinite(lon)) patch.lon = lon;

      if (Object.keys(patch).length === 0) {
        Alert.alert("Nada que aplicar", "No hay campos para actualizar.");
        setSaving(false);
        return;
      }

      const v = await supabase.from("venues").update(patch).eq("id", row.venue_id);
      if (v.error) throw v.error;

      // marcar suggestion como approved (stamps)
      const reviewerId = sessionUserId;
      if (reviewerId) {
        const s = await supabase
          .from("venue_suggestions")
          .update({
            status: "approved",
            reviewed_at: new Date().toISOString(),
            reviewed_by: reviewerId,
            resolution_note: resolutionNote.trim() || "Aplicado al local.",
          })
          .eq("id", row.id);

        if (s.error) throw s.error;
      }

      Alert.alert("OK", "Cambios aplicados al local.");
      await loadData();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo aplicar al local.");
    } finally {
      setSaving(false);
    }
  }, [
    isAdmin,
    latText,
    loadData,
    lonText,
    proposedAddress,
    proposedCity,
    proposedMapsUrl,
    resolutionNote,
    row?.id,
    row?.venue_id,
    sessionUserId,
  ]);

  const setStatus = useCallback(
    async (status: "approved" | "rejected") => {
      if (!row?.id) return;
      if (!isAdmin) return;

      const reviewerId = sessionUserId;
      if (!reviewerId) {
        Alert.alert("Sin sesión", "No hay sesión activa para revisar.");
        return;
      }

      const defaultNote =
        status === "approved"
          ? "Revisado: se acepta el reporte."
          : "Revisado: no se aplica ningún cambio.";

      const doUpdate = async (note: string) => {
        try {
          setSaving(true);

          const u = await supabase
            .from("venue_suggestions")
            .update({
              status,
              reviewed_at: new Date().toISOString(),
              reviewed_by: reviewerId,
              resolution_note: note,
            })
            .eq("id", row.id);

          if (u.error) throw u.error;

          Alert.alert("OK", `Marcado como ${showStatus(status)}.`);
          await loadData();
        } catch (e: any) {
          Alert.alert("Error", e?.message ?? "No se pudo actualizar el status.");
        } finally {
          setSaving(false);
        }
      };

      if (Platform.OS === "ios" && (Alert as any).prompt) {
        (Alert as any).prompt(
          status === "approved" ? "Aprobar reporte" : "Rechazar reporte",
          "Nota de resolución (opcional).",
          [
            { text: "Cancelar", style: "cancel" },
            { text: "Guardar", onPress: (val: string) => void doUpdate((val ?? "").trim() || defaultNote) },
          ],
          "plain-text",
          defaultNote
        );
        return;
      }

      Alert.alert(
        status === "approved" ? "Aprobar reporte" : "Rechazar reporte",
        defaultNote,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar", onPress: () => void doUpdate(defaultNote) },
        ],
        { cancelable: true }
      );
    },
    [isAdmin, loadData, row?.id, sessionUserId]
  );
  // </SECTION:ACTIONS>

  // <SECTION:RENDER>
  const venueTitle = useMemo(() => {
    if (venue?.name) return `${venue.name}${venue.city ? ` · ${venue.city}` : ""}`;
    if (row?.venue_id) return `Local ${shortId(row.venue_id)}`;
    return "Local —";
  }, [row?.venue_id, venue?.city, venue?.name]);

  if (!id) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <View style={{ padding: theme.spacing.md }}>
          <TText weight="800">Falta id</TText>
          <TText muted style={{ marginTop: 6 }}>
            No se pudo abrir este suggestion.
          </TText>
          <View style={{ marginTop: 12 }}>
            <TButton title="Volver" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: "padding", android: undefined })}
        keyboardVerticalOffset={Platform.select({ ios: 90, android: 0, default: 0 })}
      >
        <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}>
          <TCard>
            <TText weight="800">Moderación · Reporte</TText>
            <TText muted style={{ marginTop: 6 }}>
              {loading ? "Cargando…" : `Estado: ${row ? showStatus(row.status) : "—"}`}
            </TText>

            {row ? (
              <>
                <View style={{ marginTop: 10 }}>
                  <TText muted size={12}>
                    {fmtDateTime(row.created_at)} · {proposedBy}
                  </TText>
                  <TText weight="800" style={{ marginTop: 6 }}>
                    {venueTitle}
                  </TText>

                  <TText style={{ marginTop: 6 }}>{row.reason ?? "Reporte"}</TText>

                  {/* <SECTION:USER_MESSAGE_READONLY> */}
                  <TText muted size={12} style={{ marginTop: 12 }}>
                    Texto del usuario (detalles)
                  </TText>

                  {(() => {
                    const userMsg = String(row.message ?? row.payload?.message ?? row.payload?.details ?? "").trim();

                    return (
                      <TextInput
                        value={userMsg}
                        editable={false}
                        multiline
                        placeholder={userMsg ? undefined : "(El usuario no escribió detalles)"}
                        placeholderTextColor="#999"
                        style={{
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          borderRadius: theme.radius.md,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginTop: 6,
                          minHeight: 90,
                          textAlignVertical: "top",
                          color: theme.colors.text,
                          opacity: userMsg ? 1 : 0.7,
                        }}
                      />
                    );
                  })()}
                  {/* </SECTION:USER_MESSAGE_READONLY> */}
                </View>

                <Field
                  label="Ciudad (propuesta)"
                  value={proposedCity}
                  onChangeText={setProposedCity}
                  placeholder="Ciudad"
                  editable={!saving}
                />

                <Field
                  label="Dirección (propuesta)"
                  value={proposedAddress}
                  onChangeText={setProposedAddress}
                  placeholder="Dirección"
                  editable={!saving}
                />

                <Field
                  label="Google Maps URL (propuesta)"
                  value={proposedMapsUrl}
                  onChangeText={setProposedMapsUrl}
                  placeholder="https://maps.app.goo.gl/…"
                  editable={!saving}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <View style={{ flexDirection: "row", gap: 10 as any }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Lat (opcional)"
                      value={latText}
                      onChangeText={(t) => {
                        setCoordsManual(true);
                        setLatText(t);
                      }}
                      placeholder={venue?.lat === null || venue?.lat === undefined ? "—" : String(venue.lat)}
                      editable={!saving}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Lon (opcional)"
                      value={lonText}
                      onChangeText={(t) => {
                        setCoordsManual(true);
                        setLonText(t);
                      }}
                      placeholder={venue?.lon === null || venue?.lon === undefined ? "—" : String(venue.lon)}
                      editable={!saving}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <Field
                  label="Notas (admin)"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Notas internas"
                  editable={!saving}
                  multiline
                />

                <Field
                  label="Resolution note"
                  value={resolutionNote}
                  onChangeText={setResolutionNote}
                  placeholder="Nota de resolución (visible para revisión)"
                  editable={!saving}
                  multiline
                />

                <View style={{ marginTop: 14, gap: 10 as any }}>
                  <TButton
                    title="Guardar borrador"
                    variant="ghost"
                    onPress={() => void saveSuggestion()}
                    disabled={!canSave}
                  />

                  <TButton
                    title="Aplicar cambios al local"
                    onPress={() => void applyToVenue()}
                    disabled={!canApply}
                  />

                  {row.status === "pending" ? (
                    <View style={{ flexDirection: "row", gap: 10 as any, flexWrap: "wrap" }}>
                      <TButton
                        title="Aprobar"
                        variant="ghost"
                        onPress={() => void setStatus("approved")}
                        disabled={!canSave}
                      />
                      <TButton
                        title="Rechazar"
                        onPress={() => void setStatus("rejected")}
                        disabled={!canSave}
                      />
                    </View>
                  ) : (
                    <View style={{ marginTop: 6 }}>
                      <TText muted size={12}>
                        Revisado: {fmtDateTime(row.reviewed_at)} · {reviewedByLabel}
                      </TText>
                    </View>
                  )}
                </View>

                {!isAdmin ? (
                  <TText style={{ color: theme.colors.danger, marginTop: 12 }} weight="700">
                    No tienes permisos de admin.
                  </TText>
                ) : null}
              </>
            ) : (
              <View style={{ marginTop: 12 }}>
                <TText muted>No se encontró el suggestion.</TText>
              </View>
            )}
          </TCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
  // </SECTION:RENDER>
}
// </SECTION:SCREEN>
