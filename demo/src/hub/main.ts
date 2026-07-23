/* Orientation hub entry. Content is static HTML; JS pulls in the styles, stamps
 * the footer year, and arms the first-load chronos gate on the Design Studio CTA. */
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/base.css';
import { installDesignStudioGate } from './chronos-gate';

const year = document.querySelector('[data-year]');
if (year) year.textContent = String(new Date().getFullYear());

installDesignStudioGate();
