import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { face, Fonts, Tabular, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'body'
    | 'title'
    | 'subtitle'
    | 'hero'
    | 'merchant'
    | 'amount'
    | 'small'
    | 'smallBold'
    | 'label'
    | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[{ color: theme[themeColor ?? 'text'] }, textStyles[type], style]}
      {...rest}
    />
  );
}

/** Sizes, weights and tracking are the Stitch `typography` tokens, 1:1.
 *
 * Exported so <AnimatedMoney> can style its TextInput from the same scale instead of
 * keeping a second copy that would drift. */
export const textStyles = StyleSheet.create({
  body: { ...face(400), fontSize: 16, lineHeight: 24, letterSpacing: -0.16 },
  title: { ...face(600), fontSize: 24, lineHeight: 32, letterSpacing: -0.48 },
  subtitle: { ...face(600), fontSize: 20, lineHeight: 28, letterSpacing: -0.3 },
  hero: { ...face(700), fontSize: 32, lineHeight: 40, letterSpacing: -0.8, ...Tabular },
  merchant: { ...face(500), fontSize: 16, lineHeight: 22, letterSpacing: -0.16 },
  amount: { ...face(600), fontSize: 16, lineHeight: 22, letterSpacing: -0.16, ...Tabular },
  small: { ...face(400), fontSize: 14, lineHeight: 20 },
  smallBold: { ...face(600), fontSize: 14, lineHeight: 20 },
  label: {
    ...face(700),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.48,
    textTransform: 'uppercase',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 400,
    fontSize: 13,
    lineHeight: 20,
  },
});