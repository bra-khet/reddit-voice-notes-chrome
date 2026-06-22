import '../popup/style.css';
import './style.css';
import { reconcileBackgroundPreferences } from '@/src/storage/background-refs';
import { loadUserPreferences } from '@/src/settings/user-preferences';
import { mountClipStudio } from '@/src/ui/design-studio/mount-clip-studio';

const app = document.querySelector<HTMLDivElement>('#app')!;
const unmount = mountClipStudio(app);

void loadUserPreferences().then(reconcileBackgroundPreferences);

// CHANGED: pagehide (not unload) so subtitle flush in mount teardown can run before tab death.
// WHY: unload is too late for async chrome.storage writes (BUG-017).
window.addEventListener('pagehide', () => {
  unmount();
}, { once: true });