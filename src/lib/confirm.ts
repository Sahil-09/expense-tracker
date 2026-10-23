import { Alert, Platform } from 'react-native';

/**
 * A yes/no confirmation that works on every platform.
 *
 * react-native-web's `Alert.alert` is a no-op stub — it shows nothing and never calls the
 * buttons, so anything awaiting a button's `onPress` waits forever. The web build uses
 * the browser's own confirm dialog instead.
 */
export function confirmAlert(
  title: string,
  message: string,
  confirmText = 'Continue'
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)
    );
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
