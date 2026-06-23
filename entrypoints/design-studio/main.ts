import '../popup/style.css';
import './studio-palette.css';
import './studio-v4-chrome.css';
import './style.css';
import { reconcileBackgroundPreferences } from '@/src/storage/background-refs';
import { loadUserPreferences } from '@/src/settings/user-preferences';
import { mountClipStudio } from '@/src/ui/design-studio/mount-clip-studio';

const app = document.querySelector<HTMLDivElement>('#app')!;
let unmount: () => void = () => {};

// CHANGED: load + reconcile prefs before mount so studio hydrates from storage once (BUG-023).
// WHY: parallel load/reconcile/listener races left UI on Neon Glow defaults while rvnUserPrefs was correct.
async function bootDesignStudio(): Promise<void> {
  const prefs = await loadUserPreferences();
  const reconciled = await reconcileBackgroundPreferences(prefs);
  unmount = mountClipStudio(app, { initialPrefs: reconciled });
}

void bootDesignStudio();

// CHANGED: pagehide (not unload) so subtitle flush in mount teardown can run before tab death.
// WHY: unload is too late for async chrome.storage writes (BUG-017).
window.addEventListener('pagehide', () => {
  unmount();
}, { once: true });