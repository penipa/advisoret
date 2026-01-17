import React from "react";
import { View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { TText } from "./TText";
import { theme } from "../theme";

type Props = {
  value: number;          // 0..max
  max?: number;           // default 5
  size?: number;          // px
  strokeWidth?: number;   // px
  showValue?: boolean;    // número en el centro
  valueDecimals?: number; // decimales en el centro (default 1)
  valueColor?: string;    // color del centro (default dorado)
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function starPath(cx: number, cy: number, outer: number, inner: number) {
  const pts: Array<[number, number]> = [];
  const spikes = 5;
  const step = Math.PI / spikes;
  let rot = -Math.PI / 2;

  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    pts.push([cx + Math.cos(rot) * r, cy + Math.sin(rot) * r]);
    rot += step;
  }

  const [x0, y0] = pts[0];
  let d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} `;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    d += `L ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d + "Z";
}

export function RatingRing({
  value,
  max = 5,
  size = 44,
  strokeWidth = 5,
  showValue = true,
  valueDecimals = 1,
  valueColor = "#C9A35C",
}: Props) {
  const v = clamp(value, 0, max);
  const progress = max > 0 ? v / max : 0;

  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - progress);

  const cx = size / 2;
  const cy = size / 2;

  const angle = progress * 2 * Math.PI - Math.PI / 2;
  const sx = cx + r * Math.cos(angle);
  const sy = cy + r * Math.sin(angle);

  const gold = "#C9A35C";
  const track = theme?.colors?.surface2 ?? "#121624";

  const starOuter = Math.max(3.5, strokeWidth * 0.9);
  const starInner = starOuter * 0.5;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${cx}, ${cy}`}>
          <Circle cx={cx} cy={cy} r={r} stroke={track} strokeWidth={strokeWidth} fill="none" />
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={gold}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </G>

        {progress > 0 && <Path d={starPath(sx, sy, starOuter, starInner)} fill={gold} />}
      </Svg>

      {showValue && (
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <TText
            weight="800"
            style={{
              fontSize: Math.max(12, size * 0.28),
              color: valueColor,
            }}
          >
            {v.toFixed(valueDecimals)}
          </TText>
        </View>
      )}
    </View>
  );
}
