import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '@/constants/theme';

// The launch animation is the product's own metaphor rather than a generic
// fade: the logomark *is* a timer ring with a dot marking the start, so the
// ring draws itself round while the dot rides its leading edge — one pomodoro
// completing. It lands with a small settle, the wordmark and tagline stagger
// in, and the whole thing lifts away.
//
// It sits on top of the app, not in place of it: the native splash
// (expo-splash-screen) covers the very first frames before React renders at
// all and can only be a static image, so this picks up from the same mark on
// the same background and the handoff is invisible.

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 132;
const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Paced to read as a considered opening without making anyone who just wants
// to start a pomodoro wait: a shade under two seconds, all in.
const DRAW_MS = 700;
const SETTLE_MS = 260;
const WORDMARK_MS = 300;
const TAGLINE_MS = 340;
const HOLD_MS = 320;
const EXIT_MS = 380;

const TAGLINE = 'Track your work, not your energy';

export function BrandSplash({ onDone }: { onDone: () => void }): React.JSX.Element {
  const progress = useSharedValue(0);
  const settle = useSharedValue(1);
  const wordmark = useSharedValue(0);
  const tagline = useSharedValue(0);
  const cover = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(1, { duration: DRAW_MS, easing: Easing.out(Easing.cubic) });

    // A small overshoot exactly as the ring closes — the moment a pomodoro
    // lands. Timing rather than a spring so it stays in step with the draw
    // instead of settling on its own schedule.
    settle.value = withDelay(DRAW_MS - 80, withSequence(
      withTiming(1.06, { duration: SETTLE_MS * 0.4, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: SETTLE_MS * 0.6, easing: Easing.out(Easing.cubic) }),
    ));

    wordmark.value = withDelay(DRAW_MS - 60, withTiming(1, { duration: WORDMARK_MS, easing: Easing.out(Easing.quad) }));
    // Staggered behind the wordmark so the two read as a sequence rather than
    // one block appearing.
    tagline.value = withDelay(DRAW_MS + 140, withTiming(1, { duration: TAGLINE_MS, easing: Easing.out(Easing.quad) }));

    // withTiming's callback runs on the UI thread; runOnJS hops back so the
    // parent can unmount this.
    cover.value = withDelay(
      DRAW_MS + TAGLINE_MS + HOLD_MS,
      withTiming(0, { duration: EXIT_MS, easing: Easing.in(Easing.quad) }, finished => {
        if (finished) runOnJS(onDone)();
      }),
    );
  }, [progress, settle, wordmark, tagline, cover, onDone]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  // The dot rides the ring's leading edge, starting and finishing at the
  // logo's own resting angle: (74,22) against a centre of (48,48) is 45° above
  // the horizontal, up and to the right. The dot is drawn at 12 o'clock in its
  // own coordinates, hence the +45 offset. Getting this wrong makes the mark
  // jump the instant the animation takes over from the static native splash.
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${45 + progress.value * 360}deg` }],
  }));

  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: settle.value }] }));

  const centreStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.4 + progress.value * 0.6 }],
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmark.value,
    transform: [{ translateY: (1 - wordmark.value) * 10 }],
  }));

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value * 0.85,
    transform: [{ translateY: (1 - tagline.value) * 6 }],
  }));

  // Lifts away rather than just dimming, so it reads as the app arriving from
  // underneath instead of a screen switching off.
  const coverStyle = useAnimatedStyle(() => ({
    opacity: cover.value,
    transform: [{ scale: 1 + (1 - cover.value) * 0.04 }],
  }));

  return (
    <Animated.View style={[styles.cover, coverStyle]} pointerEvents="none">
      <Animated.View style={[styles.mark, markStyle]}>
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
            // Starts where the dot rests (-45°, up and to the right) so the
            // ring grows out from under it rather than from an unrelated point.
            transform="rotate(-45 48 48)"
          />
        </Svg>

        <Animated.View style={[styles.fill, dotStyle]}>
          <Svg width={SIZE} height={SIZE} viewBox="0 0 96 96">
            <Circle cx={48} cy={12} r={9} fill={colors.accent} />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.fill, styles.centre, centreStyle]}>
          <View style={styles.centreDot} />
        </Animated.View>
      </Animated.View>

      <Animated.View style={wordmarkStyle}>
        <Text style={styles.wordmark}>Pomodoso</Text>
      </Animated.View>

      <Animated.View style={taglineStyle}>
        <Text style={styles.tagline}>{TAGLINE}</Text>
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
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mark: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  centreDot: {
    width: SIZE * (20 / 96),
    height: SIZE * (20 / 96),
    borderRadius: SIZE,
    backgroundColor: colors.text,
  },
  wordmark: {
    marginTop: 24,
    fontSize: 27,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.text,
  },
  tagline: {
    marginTop: 8,
    fontSize: 13,
    letterSpacing: 0.1,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
