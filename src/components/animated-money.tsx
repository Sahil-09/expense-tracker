import { useEffect, useRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { textStyles } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { formatINR, formatINRWorklet } from '@/lib/money';

/** Text cannot be animated directly, so the digits are written to a read-only TextInput. */
type AnimatedTextInputProps = TextInputProps & { animatedProps?: { text?: string } };
const AnimatedTextInput = Animated.createAnimatedComponent(
  TextInput
) as unknown as React.ComponentType<AnimatedTextInputProps>;

const DURATION = 500;
/** Below a rupee the change is a rounding wobble, not news. Rolling for it just flickers. */
const MIN_DELTA_PAISE = 100;

/** `small` exists so a stat row can keep one type scale across animated and plain values. */
const TYPE_STYLE = {
  hero: textStyles.hero,
  amount: textStyles.amount,
  small: textStyles.smallBold,
} as const;

/**
 * An amount that rolls to its new value instead of snapping.
 *
 * Driven entirely on the UI thread. Doing this with React state would re-render the whole
 * Timeline on every frame, and would stutter exactly when a scan is saturating the bridge.
 *
 * <AnimatedTextInput> is read-only and never focused — it is a text view that happens to be
 * animated, and carries an accessibility label so it is still announced as one value.
 */
export function AnimatedMoney({
  paise,
  type = 'amount',
}: {
  paise: number;
  type?: keyof typeof TYPE_STYLE;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const display = useSharedValue(paise);
  const mounted = useRef(false);

  useEffect(() => {
    // The first value is the starting value, not a change to roll to: a ₹2.5 lakh total
    // counting up from zero on every cold start is noise, not information.
    if (!mounted.current || reducedMotion) {
      mounted.current = true;
      display.value = paise;
      return;
    }
    if (Math.abs(paise - display.value) < MIN_DELTA_PAISE) {
      display.value = paise;
      return;
    }
    display.value = withTiming(paise, { duration: DURATION, easing: Easing.out(Easing.cubic) });
  }, [paise, reducedMotion, display]);

  // `text` is not a declared TextInput prop, so the hook needs the cast; reanimated's own
  // types for an animated prop on a custom component cannot see it.
  //
  // `defaultValue` goes in as well: on Android the native text only follows a prop that
  // changes, and `text` is not one it knows, so without it the digits froze on whatever
  // the counter was when it mounted. This is reanimated's own counter pattern.
  const animatedProps = useAnimatedProps(
    () =>
      ({
        text: formatINRWorklet(display.value),
        defaultValue: formatINRWorklet(display.value),
      }) as { text: string; defaultValue: string }
  );

  return (
    <AnimatedTextInput
      editable={false}
      scrollEnabled={false}
      // Android draws a default underline on TextInput; this is not an input.
      underlineColorAndroid="transparent"
      // animatedProps only pushes on *change*, so a freshly mounted counter whose value has
      // not moved since mount would render an empty box. defaultValue seeds the native text;
      // it is read once at creation, so it never fights the animation.
      defaultValue={formatINR(paise)}
      accessible
      accessibilityLabel={formatINR(paise)}
      animatedProps={animatedProps}
      // Android gives TextInput default vertical padding, which pushes its digits a few dp
      // below a sibling <Text> on the same line. Zero it only at the small scale where a
      // stat row sits beside a plain <Text>; the hero/amount scales keep their own rhythm.
      style={[{ color: theme.text, padding: type === 'small' ? 0 : undefined }, TYPE_STYLE[type]]}
    />
  );
}