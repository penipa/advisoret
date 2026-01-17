import React, { useEffect, useMemo, useRef } from "react";
import { Animated, View, ViewProps } from "react-native";
import { theme } from "../theme";

type Props = ViewProps & {
  elevated?: boolean;
  compact?: boolean;

  /**
   * Apple-ish micro: si true, aplica un acabado un pelín más "glass" (solo estilos),
   * sin cambiar la API ni romper nada.
   */
  glass?: boolean;
};

export function TCard({
  style,
  elevated = true,
  compact = false,
  glass = true,
  ...props
}: Props) {
  // por compatibilidad: si tu theme no tiene surface2, caemos a surface
  const surface2 = useMemo(() => (theme.colors as any).surface2 ?? theme.colors.surface, []);

  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: glass ? surface2 : theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: compact ? theme.spacing.sm : theme.spacing.md,

          // ✅ para que contenidos respeten el radio (premium feel)
          overflow: "hidden",
        },
        elevated ? theme.shadow.card : null,
        style,
      ]}
    />
  );
}

/**
 * ✅ Skeletons reutilizables (Apple-ish): pulso suave, bordes consistentes.
 * No dependen de librerías externas y no rompen nada.
 */

type SkeletonBaseProps = {
  width?: number | string;
  height: number;
  radius?: number;
  style?: any;
};

function usePulseOpacity() {
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    );

    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return opacity;
}

export function TSkeletonBox({ width = "100%", height, radius, style }: SkeletonBaseProps) {
  const opacity = usePulseOpacity();

  // por compatibilidad: si tu theme no tiene surface2, caemos a surface
  const bg = useMemo(() => (theme.colors as any).surface2 ?? theme.colors.surface, []);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: bg,
          opacity,
        },
        style,
      ]}
    />
  );
}

type SkeletonLineProps = {
  width?: number | string; // e.g. "60%"
  height?: number; // default 14
  radius?: number; // default pill-ish
  style?: any;
};

export function TSkeletonLine({ width = "60%", height = 14, radius, style }: SkeletonLineProps) {
  return <TSkeletonBox width={width} height={height} radius={radius ?? 999} style={style} />;
}
