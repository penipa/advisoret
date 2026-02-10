export const theme = {
  colors: {
    // Core surfaces (dark, “Apple Pro”)
    bg: "#07090D",
    surface: "#0E1320",
    surface2: "#0B0F14",
    border: "rgba(255,255,255,0.10)",

    // Text
    text: "#E8EAF0",
    textMuted: "rgba(232,234,240,0.70)",

    // Brand accents
    gold: "#C9A35C",
    primary: "#C9A35C", // primary CTA = gold (coherente con el branding)
    success: "#34D399",
    danger: "#EF4444",
  },

  spacing: {
    xxs: 4,
    xs: 6,
    sm: 10,
    md: 16,
    lg: 22,
    xl: 28,
    xxl: 34,
  },

  radius: {
    sm: 12,
    md: 14,
    lg: 18,
    xl: 24,
    pill: 999,
  },

  font: {
    title: 26,
    h2: 18,
    body: 15,
    small: 13,
    caption: 12,
  },

  // Cross-platform “soft elevation”
  shadow: {
    card: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.18,
      shadowRadius: 18,
      elevation: 3,
    },
  },
};
