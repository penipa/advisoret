// src/components/CriterionHelpIcon.tsx
import { useMemo, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { theme } from "../theme";
import { TText } from "../ui/TText";
import { CriterionLike, getCriterionHelp } from "../content/criteriaHelp";

export function CriterionHelpIcon({
  productTypeId,
  criterion,
}: {
  productTypeId: string;
  criterion: CriterionLike;
}) {
  const [open, setOpen] = useState(false);

  const help = useMemo(() => getCriterionHelp(productTypeId, criterion), [productTypeId, criterion]);

  if (!help) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        style={{
          width: 26,
          height: 26,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.surface2,
        }}
      >
        <TText muted weight="800" style={{ lineHeight: 18 }}>
          i
        </TText>
      </Pressable>

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            padding: theme.spacing.md,
            justifyContent: "center",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.bg,
              padding: theme.spacing.lg,
            }}
          >
            <TText weight="800" size={18}>
              {help.title}
            </TText>

            <TText muted style={{ marginTop: 10, lineHeight: 20 }}>
              {help.body}
            </TText>

            <Pressable
              onPress={() => setOpen(false)}
              style={{
                marginTop: theme.spacing.lg,
                alignSelf: "flex-end",
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <TText weight="800">Cerrar</TText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
