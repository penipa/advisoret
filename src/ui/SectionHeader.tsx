import React from "react";
import { View, StyleProp, ViewStyle } from "react-native";
import { theme } from "../theme";
import { TText } from "./TText";
import { TButton } from "./TButton";

export function SectionHeader({
  title,
  actionTitle,
  onActionPress,
  actionDisabled = false,
  style,
}: {
  title: string;
  actionTitle?: string;
  onActionPress?: () => void;
  actionDisabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: 40,
        },
        style,
      ]}
    >
      <TText size={theme.font.h2} weight="700">
        {title}
      </TText>

      {actionTitle ? (
        <TButton
          title={actionTitle}
          variant="ghost"
          disabled={actionDisabled}
          onPress={onActionPress}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            alignSelf: "flex-start",
          }}
        />
      ) : null}
    </View>
  );
}
