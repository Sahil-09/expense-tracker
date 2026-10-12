import { View, type ViewProps } from 'react-native';

import { type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  /** Which palette slot to paint the view with. Defaults to the app background. */
  type?: ThemeColor;
};

export function ThemedView({ style, type, ...rest }: ThemedViewProps) {
  const theme = useTheme();
  return <View style={[{ backgroundColor: theme[type ?? 'background'] }, style]} {...rest} />;
}