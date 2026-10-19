import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { LineIcon } from '@/components/ui-kit';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addMonths, monthLabel } from '@/lib/money';

export function MonthBar({ monthMs, onChange }: { monthMs: number; onChange: (ms: number) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.pill,
          { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={12}
          style={styles.arrow}
          onPress={() => onChange(addMonths(monthMs, -1))}>
          <LineIcon name="chevronLeft" size={16} color={theme.textMuted} />
        </Pressable>

        <View style={styles.label}>
          <LineIcon name="calendar" size={14} color={theme.accent} />
          <ThemedText type="smallBold" style={{ fontSize: 12 }}>{monthLabel(monthMs)}</ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={12}
          style={styles.arrow}
          onPress={() => onChange(addMonths(monthMs, 1))}>
          <LineIcon name="chevronRight" size={16} color={theme.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
  },
  arrow: {
    width: 28,
    height: 28,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.one },
});
