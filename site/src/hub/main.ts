/* Orientation hub entry (Phase 0 placeholder). Content is static HTML; JS only
 * pulls in the styles and stamps the footer year. */
import '../styles/tokens.css';
import '../styles/base.css';

const year = document.querySelector('[data-year]');
if (year) year.textContent = String(new Date().getFullYear());
