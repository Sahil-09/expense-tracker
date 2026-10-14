import {
  Stack,
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  router,
  usePathname,
  type Href,
} from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { useEffect, useMemo } from 'react';
import { BackHandler, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SmsPermissionGate } from '@/components/sms-permission-gate';
import { ThemeModeProvider, useTheme, useThemeMode } from '@/hooks/use-theme';
import { hasSmsPermission, runScan, startLiveCapture } from '@/lib/sms';

SplashScreen.preventAutoHideAsync();

// Without a handler an expense notification arriving while the app is open is silently
// dropped. SDK 57 renamed shouldShowAlert to shouldShowBanner/shouldShowList.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Tabs that sit after Timeline, where back should land on Timeline instead of exiting. */
const SECONDARY_TABS = ['/add', '/budgets', '/insights', '/settings'];

/**
 * The auto-scan is a once-per-launch thing, so it is guarded here rather than by an empty
 * dep array alone. The root layout can mount more than once in the life of a process —
 * a Fast Refresh, a theme change re-creating the tree — and each remount would otherwise
 * start another full-inbox scan on top of the one still running. This resets only when
 * the JS process does, which is exactly what "on launch" means.
 */
let autoScanned = false;

/**
 * The only route an expense notification ever links to. Matching it is what lets the
 * string become a typed Href, and keeps a tampered payload from navigating anywhere.
 */
const EXPENSE_ROUTE = /^\/expense\/\d+$/;

const urlOf = (n: Notifications.Notification): Href | null => {
  const url = n.request.content.data?.url;
  return typeof url === 'string' && EXPENSE_ROUTE.test(url) ? (url as Href) : null;
};

export default function RootLayout() {
  return (
    <ThemeModeProvider>
      <NavigationShell />
    </ThemeModeProvider>
  );
}

function NavigationShell() {
  const theme = useTheme();
  const { isDark } = useThemeMode();

  // App-wide, so a bank SMS is captured no matter which tab is open. Also drains
  // anything the manifest receiver queued while the app was closed.
  useEffect(() => {
    startLiveCapture();
  }, []);


  // expo-router's native tabs never handle a back action (NativeBottomTabsRouter has no
  // GO_BACK branch, and backBehavior is only its default), so back on any tab but Timeline
  // pops the whole tabs screen and drops out of the app. Land on Timeline first instead.
  const pathname = usePathname();
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!SECONDARY_TABS.includes(pathname)) return false;
      router.navigate('/');
      return true;
    });
    return () => sub.remove();
  }, [pathname]);

  // Tapping an expense notification opens that expense. The last response is read too,
  // since a notification that cold-starts the app fires no tap while JS is still booting.
  useEffect(() => {
    const open = (n: Notifications.Notification) => {
      const url = urlOf(n);
      if (url !== null) router.push(url);
    };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification);
    });

    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) {
      open(last.notification);
      // Otherwise every later launch would re-open whatever was last tapped.
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }

    return () => sub.remove();
  }, []);

  // Rendering before Inter arrives flashes the system face, then swaps. Hold the tree.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Built on expo-router's own themes so the stack header inherits the app palette
  // without re-declaring the font tokens React Navigation expects.
  const navTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      dark: isDark,
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        primary: theme.accent,
        background: theme.background,
        card: theme.surface,
        text: theme.text,
        border: theme.border,
        notification: theme.accent,
      },
    }),
    [isDark, theme]
  );

  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: theme.background }} />;

  return (
    <ThemeProvider value={navTheme}>
      <AnimatedSplashOverlay />
      <SmsPermissionGate />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="expense/[id]" options={{ title: 'Expense' }} />
      </Stack>
    </ThemeProvider>
  );
}