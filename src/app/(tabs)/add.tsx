import { PasteForm } from '@/components/paste-form';

/**
 * The centre tab of the Stitch bar.
 *
 * It renders the paste form directly rather than redirecting to it: a redirect on mount
 * would fire again every time you navigate back here, trapping you on this screen.
 */
export default function AddRoute() {
  return <PasteForm />;
}