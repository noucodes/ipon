import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/** Smooth trend line with a soft fill underneath. values: number[] */
export function Sparkline({ values, color, height = 70 }) {
  const [width, setWidth] = useState(0);
  const ok = values?.length > 1 && width > 0;
  let line = '';
  let area = '';
  if (ok) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [
      (i / (values.length - 1)) * width,
      height - 6 - ((v - min) / span) * (height - 12),
    ]);
    // simple smoothing with midpoints
    line = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      line += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
    }
    area = `${line} L${width},${height} L0,${height} Z`;
  }
  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel="Net worth trend">
      {ok && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.25" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}
