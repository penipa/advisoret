import React from "react";
import { Pressable, ViewStyle, StyleProp } from "react-native";
import { theme } from "../theme";
import { TText } from "./TText";

export function TButton({
  title,
  onPress,
  variant = "primary",
  style,
  disabled = false,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "ghost";
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => {
        const pressStyle: ViewStyle = {
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          // RN no tolera transform: null
          transform: pressed && !disabled ? [{ scale: 0.99 }] : [],
        };

        return [
          {
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isPrimary ? theme.colors.primary : "transparent",
            borderWidth: isPrimary ? 0 : 1,
            borderColor: theme.colors.border,
          },
          style,
          pressStyle,
        ];
      }}
    >
      <TText weight="700" style={{ color: isPrimary ? "#062014" : theme.colors.text }}>
        {title}
      </TText>
    </Pressable>
  );
}
