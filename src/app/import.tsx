import { Redirect } from 'expo-router';

/** Keeps `expensetracker://import` and any old links working. The UI lives in the tab. */
export default function ImportScreen() {
  return <Redirect href="/add" />;
}