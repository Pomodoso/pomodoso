import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';

import { colors } from '@/constants/theme';

// The launch animation is the product's own metaphor rather than a generic
// fade: the logomark *is* a timer ring with a dot marking the start, so the
// ring draws itself round while the dot rides its leading edge — one pomodoro
// completing. Then the wordmark arrives and the whole thing lifts away.
//
// It sits on top of the app, not in place of it: the native splash
// (expo-splash-screen) covers the very first frames before React renders at
// all and can only be a static image, so this picks up from the same mark on
// the same background and the handoff is invisible.

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 132;
const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Long enough to read as deliberate, short enough that nobody waiting to start
// a pomodoro resents it.
const DRAW_MS = 620;
const WORDMARK_MS = 260;
const HOLD_MS = 220;
const FADE_MS = 320;

export function BrandSplash({ onDone }: { onDone: () => void }): React.JSX.Element {
  const progress = useSharedValue(0);
  const wordmark = useSharedValue(0);
  const cover = useSharedValue(1);

  useEffect(() => {
    // withTiming's callback fires on the UI thread; runOnJS hops back so the
    // parent can unmount this.
    progress.value = withTiming(1, { duration: DRAW_MS, easing: Easing.out(Easing.cubic) });
    wordmark.value = withDelay(DRAW_MS - 120, withTiming(1, { duration: WORDMARK_MS, easing: Easing.out(Easing.quad) }));
    cover.value = withDelay(DRAW_MS + WORDMARK_MS + HOLD_MS, withTiming(0, { duration: FADE_MS }, finished => {
      if (finished) runOnJS(onDone)();
    }));
  }, [progress, wordmark, cover, onDone]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  // The dot rides the ring's leading edge. -90° puts the start at 12 o'clock,
  // where the static mark already has it, so the animation begins on the frame
  // the native splash was showing.
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-90 + progress.value * 360}deg` }],
  }));

  const centreStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.4 + progress.value * 0.6 }],
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmark.value,
    transform: [{ translateY: (1 - wordmark.value) * 8 }],
  }));

  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));

  return (
    <Animated.View style={[styles.cover, coverStyle]} pointerEvents="none">
      <View style={styles.mark}>
        <Svg width={SIZE} height={SIZE} viewBox="0 0 96 96">
          <AnimatedCircle
            cx={48}
            cy={48}
            r={RADIUS}
            fill="none"
            stroke={colors.accent}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            animatedProps={ringProps}
            // Drawn from 12 o'clock clockwise, like the timer ring on Home.
            transform="rotate(-90 48 48)"
          />
        </Svg>

        <Animated.View style={[StyleSheet.absoluteFill, dotStyle]}>
          <Svg width={SIZE} height={SIZE} viewBox="0 0 96 96">
            <G>
              <Circle cx={48} cy={12} r={9} fill={colors.accent} />
            </G>
          </Svg>
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, styles.centre, centreStyle]}>
          <View style={styles.centreDot} />
        </Animated.View>
      </View>

      <Animated.View style={wordmarkStyle}>
        <Text style={styles.wordmark}>Pomodoso</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  mark: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  centreDot: {
    width: SIZE * (20 / 96),
    height: SIZE * (20 / 96),
    borderRadius: SIZE,
    backgroundColor: colors.text,
  },
  wordmark: {
    marginTop: 22,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.text,
  },
});
