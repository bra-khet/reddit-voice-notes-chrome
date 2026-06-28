/* Voice Studio entry (Phase 0 skeleton). Mounts the themed nav banner; the voice
 * authoring surface is added in Phases 1–5. */
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/nav-banner.css';
import { mountNavBanner } from './nav-banner';

const host = document.querySelector<HTMLElement>('[data-nav-banner]');
if (host) mountNavBanner(host);
