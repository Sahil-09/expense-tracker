import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { tint } from '@/components/ui-kit';
import { useTheme } from '@/hooks/use-theme';

export default function TabLayout() {
  const theme = useTheme();

  return (
    <NativeTabs
      backgroundColor={theme.surface}
      iconColor={{ default: theme.textMuted, selected: theme.accent }}
      labelStyle={{ default: { fontSize: 11 }, selected: { fontSize: 11 } }}
      indicatorColor={tint(theme.accent, 0.16)}>
      {/* `sf` is iOS-only: on Android the tab bar ignores it and needs `md`, or the
          icons come out blank. Both props together is the supported cross-platform pair. */}
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'clock', selected: 'clock.fill' }}
          md={{ default: 'history', selected: 'history' }}
        />
        <NativeTabs.Trigger.Label>Timeline</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="insights">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'chart.pie', selected: 'chart.pie.fill' }}
          md={{ default: 'pie_chart', selected: 'pie_chart' }}
        />
        <NativeTabs.Trigger.Label>Insights</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/* Stitch's centre item. It is a real tab, not an overlay: NativeTabs only spaces
          items by count, so the five equal slots need a fifth trigger, and a real
          trigger also means native taps and back navigation keep working. */}
      <NativeTabs.Trigger name="add">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'plus', selected: 'plus.circle.fill' }}
          md={{ default: 'add', selected: 'add_circle' }}
        />
        <NativeTabs.Trigger.Label>Add</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="budgets">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gauge.with.needle', selected: 'gauge.with.needle.fill' }}
          md={{ default: 'donut_small', selected: 'donut_small' }}
        />
        <NativeTabs.Trigger.Label>Budgets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
          md={{ default: 'settings', selected: 'settings' }}
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}