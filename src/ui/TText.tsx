import { Text, TextProps } from "react-native";
import { theme } from "../theme";

type Props = TextProps & {
  muted?: boolean;
  weight?: "400" | "600" | "700" | "800";
  size?: number;
  // For tiny UI labels (“pill”, meta, etc.)
  caps?: boolean;
};

export function TText({
  muted,
  weight = "400",
  size = theme.font.body,
  caps,
  style,
  ...props
}: Props) {
  const color = muted ? theme.colors.textMuted : theme.colors.text;

  return (
    <Text
      {...props}
      style={[
        {
          color,
          fontSize: size,
          fontWeight: weight,
          lineHeight: Math.round(size * 1.28),
          letterSpacing: caps ? 0.6 : 0,
          textTransform: caps ? "uppercase" : "none",
          includeFontPadding: false, // Android: evita “aire” extra arriba/abajo
        },
        style,
      ]}
    />
  );
}
