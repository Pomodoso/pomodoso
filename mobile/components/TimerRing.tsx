import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, fontMono } from '@/constants/theme';

interface TimerRingProps {
  size: number;
  progress: number; // 0..1
  timeLabel: string;
  color?: string;
  children?: React.ReactNode;
}

const STROKE = 6;

export function TimerRing({ size, progress, timeLabel, color = colors.accent, children }: TimerRingProps) {
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={[styles.time, { fontSize: size * 0.24 }]}>{timeLabel}</Text>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  time: {
    fontFamily: fontMono,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -1,
  },
});
