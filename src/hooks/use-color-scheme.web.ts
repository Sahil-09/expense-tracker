import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/** Nothing to subscribe to: the store only reports whether the client has taken over. */
const subscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * `useSyncExternalStore` says it without state: the server snapshot is 'light' (it cannot
 * know the colour scheme) and the client snapshot is 'true' (it can). Reading it during
 * render is what makes it hydration-safe, and it leaves no effect to set state in.
 */
export function useColorScheme() {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

  const colorScheme = useRNColorScheme();

  return hydrated ? colorScheme : 'light';
}
