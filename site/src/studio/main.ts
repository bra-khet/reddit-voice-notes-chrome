/* Voice Studio entry. Mounts the themed nav banner + the voice authoring panel.
 * Audition (Phase 3) and copy/paste transfer (Phase 4) mount into the panel's slots. */
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/nav-banner.css';
import '../styles/voice-panel.css';
import { mountNavBanner } from './nav-banner';
import { mountVoicePanel } from './voice-panel';

const navHost = document.querySelector<HTMLElement>('[data-nav-banner]');
if (navHost) mountNavBanner(navHost);

const panelHost = document.querySelector<HTMLElement>('[data-voice-panel]');
if (panelHost) mountVoicePanel(panelHost);
