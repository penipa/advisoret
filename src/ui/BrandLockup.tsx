import React from "react";
import { View, Image, ImageSourcePropType, StyleProp, ViewStyle } from "react-native";
import { theme } from "../theme";
import { TText } from "./TText";

type Props = {
  title?: string;            // "Advisoret"
  subtitle?: string;         // "Esmorzarets"
  size?: "lg" | "md";
  style?: StyleProp<ViewStyle>;

  iconSource?: ImageSourcePropType;     // PNG transparente de la A
  wordmarkSource?: ImageSourcePropType; // (opcional)
  tag?: string;                         // contexto (opcional)
};

export function BrandLockup({
  title = "Advisoret",
  subtitle,
  size = "lg",
  style,
  iconSource,
  wordmarkSource,
  tag,
}: Props) {
  const iconBox = size === "lg" ? 34 : 28;
  const wordmarkHeight = size === "lg" ? 22 : 18;

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        style,
      ]}
    >
      {/* Izquierda: icono + (wordmark o texto) */}
      <View style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0 }}>
        {/* Icono en cápsula/círculo */}
        <View
          style={{
            width: iconBox,
            height: iconBox,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface2,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {iconSource ? (
            <Image source={iconSource} style={{ width: iconBox, height: iconBox }} resizeMode="cover" />
          ) : (
            <TText weight="800" size={size === "lg" ? 14 : 12} style={{ color: theme.colors.gold }}>
              A
            </TText>
          )}
        </View>

        {/* Texto / Wordmark */}
        <View style={{ marginLeft: 10, flex: 1, minWidth: 0 }}>
          {wordmarkSource ? (
            <Image
              source={wordmarkSource}
              style={{
                height: wordmarkHeight,
                width: "100%",
                maxWidth: 240,
                resizeMode: "contain",
              }}
            />
          ) : (
            <TText
              weight="800"
              size={size === "lg" ? theme.font.title : theme.font.h2}
              numberOfLines={1}
              style={{ color: theme.colors.text }}
            >
              {title}
            </TText>
          )}

          {subtitle ? (
            <TText
              weight="700"
              size={theme.font.caption}
              numberOfLines={1}
              style={{
                marginTop: 2,
                color: theme.colors.gold,
                letterSpacing: 0.2,
              }}
            >
              {subtitle}
            </TText>
          ) : null}
        </View>
      </View>

      {/* Derecha: tag pill (oro suave, premium) */}
      {tag ? (
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(201,163,92,0.25)",
            backgroundColor: "rgba(201,163,92,0.08)",
          }}
        >
          <TText size={12} weight="800" caps style={{ color: theme.colors.gold }}>
            {tag}
          </TText>
        </View>
      ) : null}
    </View>
  );
}
