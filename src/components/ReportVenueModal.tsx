import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

const REASONS = [
  { value: "Dirección incorrecta", key: "address" },
  { value: "Coordenadas mal", key: "coords" },
  { value: "Cerrado / ya no existe", key: "closed" },
  { value: "Nombre incorrecto", key: "name" },
  { value: "Otro", key: "other" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

export function ReportVenueModal(props: {
  visible: boolean;
  venueName?: string;
  onClose: () => void;
  onSubmit: (data: { reason: string; message: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { visible, onClose, onSubmit, venueName } = props;

  const [reason, setReason] = useState<Reason | "">("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const title = useMemo(() => {
    return venueName
      ? t("reportModal.titleWithVenue", { venueName })
      : t("reportModal.titleFallback");
  }, [venueName, t]);

  const canSubmit = reason !== "" && !submitting;

  const reset = () => {
    setReason("");
    setMessage("");
    setSubmitting(false);
  };

  const close = () => {
    if (!submitting) {
      reset();
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (!reason) {
      Alert.alert(t("reportModal.missingReasonTitle"), t("reportModal.missingReasonMsg"));
      return;
    }
    try {
      setSubmitting(true);
      await onSubmit({ reason, message });

      // ✅ IMPORTANTE: no mostramos Alert de éxito aquí para evitar duplicados.
      // El caller (pantalla de venue) puede mostrar su confirmación.
      reset();
      onClose();
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : "No se pudo enviar el reporte. Inténtalo de nuevo.";
      Alert.alert(t("common.error"), msg);
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />

      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={close} disabled={submitting} style={styles.xBtn}>
            <Text style={styles.xText}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{t("reportModal.reasonLabel")}</Text>

          <View style={styles.reasonsWrap}>
            {REASONS.map((r) => {
              const active = r.value === reason;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setReason(r.value)}
                  style={[styles.reasonPill, active && styles.reasonPillActive]}
                >
                  <Text style={[styles.reasonText, active && styles.reasonTextActive]}>
                    {t(`reportModal.reason.${r.key}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>{t("reportModal.detailsLabel")}</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={t("reportModal.detailsPlaceholder")}
            placeholderTextColor="#999"
            multiline
            style={styles.textarea}
            editable={!submitting}
            textAlignVertical="top"
            autoCorrect
          />

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          >
            {submitting ? <ActivityIndicator /> : <Text style={styles.submitText}>{t("reportModal.submit")}</Text>}
          </Pressable>

          <Text style={styles.hint}>{t("reportModal.pendingHint")}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ✅ También export default, por si algún import lo pide así
export default ReportVenueModal;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    left: 14,
    right: 14,
    top: Platform.select({ ios: 90, android: 70, default: 80 }),
    bottom: Platform.select({ ios: 90, android: 70, default: 80 }),
    backgroundColor: "#fff",
    borderRadius: 18,
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e6e6e6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 16, fontWeight: "700", flex: 1, paddingRight: 12 },
  xBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#f2f2f2" },
  xText: { fontSize: 14, fontWeight: "800" },

  body: { padding: 16 },
  label: { fontSize: 13, fontWeight: "700", marginBottom: 8 },

  reasonsWrap: { flexDirection: "row", flexWrap: "wrap" },
  reasonPill: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e6e6e6",
    backgroundColor: "#fff",
    marginRight: 8,
    marginBottom: 8,
  },
  reasonPillActive: {
    borderColor: "#111",
    backgroundColor: "#111",
  },
  reasonText: { fontSize: 13, fontWeight: "600", color: "#111" },
  reasonTextActive: { color: "#fff" },

  textarea: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: "#e6e6e6",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 18,
  },

  submitBtn: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#111",
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  hint: { marginTop: 10, fontSize: 12, color: "#777" },
});
