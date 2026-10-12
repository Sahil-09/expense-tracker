import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addMonths, monthLabel } from '@/lib/money';

export function MonthBar({ monthMs, onChange }: { monthMs: number; onChange: (ms: number) => void }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        hitSlop={12}
        style={styles.arrow}
        onPress={() => onChange(addMonths(monthMs, -1))}>
        <ThemedText type="subtitle">‹</ThemedText>
      </Pressable>
      <ThemedText type="subtitle">{monthLabel(monthMs)}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next month"
        hitSlop={12}
        style={styles.arrow}
        onPress={() => onChange(addMonths(monthMs, 1))}>
        <ThemedText type="subtitle">›</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two,
  },
  arrow: { paddingHorizontal: Spacing.two },
});