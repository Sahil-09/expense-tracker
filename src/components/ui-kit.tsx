import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewProps } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORY_COLORS, type Category } from '@/lib/categories';

/** `tint('#F97316', 0.14)` -> `rgba(249, 115, 22, 0.14)`. RN has no colour-mix(). */
export function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
      {...rest}
    />
  );
}

/** The design system's `label-md`: uppercase, tracked, muted. */
export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <Text style={[styles.label, { color: theme.textMuted }, style]}>{children}</Text>
  );
}

export function Chip({
  label,
  selected = false,
  color,
  onPress,
}: {
  label: string;
  selected?: boolean;
  color?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tintColor = color ?? theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${label}`}
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? tintColor : tint(tintColor, 0.12),
          borderColor: selected ? tintColor : tint(tintColor, 0.24),
        },
      ]}
      onPress={onPress}>
      <View style={[styles.chipDot, { backgroundColor: selected ? '#FFFFFF' : tintColor }]} />
      <Text style={[styles.chipLabel, { color: selected ? '#FFFFFF' : tintColor }]}>{label}</Text>
    </Pressable>
  );
}

/** 24x24 stroke glyphs, drawn so they read at 20px. One path set per category. */
const GLYPHS: Record<Category, ReactNode> = {
  Food: (
    <>
      <Path d="M4.5 2v4a2.5 2.5 0 0 0 5 0V2M7 8.5V22" />
      <Path d="M17 2c-1.6 2.2-2.2 4.4-2.2 6.4 0 1.8 1 2.6 2.2 2.6V22" />
    </>
  ),
  Groceries: (
    <>
      <Path d="M3 9h18l-1.6 10.2A2 2 0 0 1 17.4 21H6.6a2 2 0 0 1-2-1.8L3 9Z" />
      <Path d="M8.5 9 11 3M15.5 9 13 3" />
    </>
  ),
  Transport: (
    <>
      <Path d="M4 16v-3.2l2-5h12l2 5V16" />
      <Path d="M3 16h18" />
      <Circle cx="7.5" cy="17.6" r="1.6" />
      <Circle cx="16.5" cy="17.6" r="1.6" />
    </>
  ),
  Shopping: (
    <>
      <Path d="M5 8h14l-1 12H6L5 8Z" />
      <Path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  Bills: (
    <>
      <Path d="M6 3h12v18l-2.4-1.4L13.2 21l-2.4-1.4L8.4 21 6 19.6V3Z" />
      <Path d="M9 8h6M9 12h6" />
    </>
  ),
  Health: <Path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z" />,
  Entertainment: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M10 8.6 16 12l-6 3.4V8.6Z" />
    </>
  ),
  Transfer: (
    <>
      <Path d="M4 9h13l-3.2-3.2" />
      <Path d="M20 15H7l3.2 3.2" />
    </>
  ),
  Other: (
    <>
      <Circle cx="5.5" cy="12" r="1.6" />
      <Circle cx="12" cy="12" r="1.6" />
      <Circle cx="18.5" cy="12" r="1.6" />
    </>
  ),
};

export function CategoryIcon({
  category,
  size = 20,
  color,
}: {
  category: Category;
  size?: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[category]}
    </Svg>
  );
}

/** Tinted rounded square carrying the category colour, as the design system specifies. */
export function IconWell({ category, size = 40 }: { category: Category; size?: number }) {
  const color = CATEGORY_COLORS[category];
  return (
    <View
      style={[
        styles.iconWell,
        { width: size, height: size, borderRadius: size / 3, backgroundColor: tint(color, 0.16) },
      ]}>
      <CategoryIcon category={category} size={size * 0.52} color={color} />
    </View>
  );
}

const LINE_GLYPHS: Record<string, ReactNode> = {
  doc: <Path d="M6 3h8l4 4v14H6V3Z M14 3v4h4" />,
  check: <Path d="M5 12.8 9.8 17.5 19 6.8" />,
  chart: <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  message: <Path d="M4 5h16v11H9l-5 4V5Z" />,
  gear: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
  warning: (
    <>
      <Path d="M12 3 2.5 20h19L12 3Z" />
      <Path d="M12 9v5M12 17.2v.1" />
    </>
  ),
  refresh: (
    <>
      <Path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <Path d="M20 4v7h-7" />
    </>
  ),
  sun: (
    <>
      <Circle cx="12" cy="12" r="4" />
      <Path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <Path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  laptop: (
    <>
      <Path d="M5 6h14v10H5V6Z" />
      <Path d="M2 19h20" />
    </>
  ),
};

export function LineIcon({ name, size = 18, color }: { name: keyof typeof LINE_GLYPHS | string; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {LINE_GLYPHS[name] ?? LINE_GLYPHS.doc}
    </Svg>
  );
}

export function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.surfaceHigh }]}>
      <View
        style={[styles.fill, { width: `${Math.min(Math.max(pct, 0), 100)}%`, backgroundColor: color }]}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = 'accent',
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'danger';
  disabled?: boolean;
  icon?: string;
}) {
  const theme = useTheme();
  const accent = tone === 'danger';
  const fg = accent ? theme.danger : theme.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        accent
          ? { borderWidth: 1, borderColor: tint(theme.danger, 0.5), backgroundColor: 'transparent' }
          : { backgroundColor: theme.accent },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
      onPress={onPress}>
      <View style={styles.buttonInner}>
        {icon !== undefined && <LineIcon name={icon} size={17} color={fg} />}
        <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: 6,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  iconWell: { alignItems: 'center', justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  button: { borderRadius: Radii.md, paddingVertical: Spacing.three - 2, alignItems: 'center' },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  buttonLabel: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});