import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { tint } from '@/components/ui-kit';
import { useTheme, useThemeMode } from '@/hooks/use-theme';

export default function TabLayout() {
  const theme = useTheme();
  const { isDark } = useThemeMode();

  return (
    <NativeTabs
      backgroundColor={theme.surface}
      iconColor={{ default: theme.textMuted, selected: theme.accent }}
      labelStyle={{
        // Without an explicit colour the native bar falls back to the platform's own
        // onSurfaceVariant, which is dim against this palette. Dark mode wants the
        // labels white so they read against the dark bar.
        default: { fontSize: 11, color: isDark ? theme.text : theme.textMuted },
        selected: { fontSize: 11, color: theme.accent },
      }}
      // Material's default 'auto' hides the unselected labels on Android, so the white
      // dark-mode label would only ever show on the active tab.
      labelVisibilityMode="labeled"
      indicatorColor={tint(theme.accent, 0.16)}>
      {/* `src` alone works on both platforms; `renderingMode="template"` makes iOS tint the
          Icons8 PNG with `iconColor`. Android tints image icons via the tab's itemIconTintList. */}
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tab-timeline.png')}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Timeline</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="insights">
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tab-insights.png')}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Insights</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/* Stitch's centre item. It is a real tab, not an overlay: NativeTabs only spaces
          items by count, so the five equal slots need a fifth trigger, and a real
          trigger also means native taps and back navigation keep working. */}
      <NativeTabs.Trigger name="add">
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tab-add.png')}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Add</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="budgets">
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tab-budgets.png')}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Budgets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tab-settings.png')}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
