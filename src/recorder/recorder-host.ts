/**
 * v5.4.0 Phase 0 Prep — host contract skeleton only (no implementation).
 *
 * FABLE / MAIN AGENT: implement mountRecorder by refactoring RecorderPanel +
 * VoiceRecorderSession for multi-host use (studio modal, Reddit shadow-DOM, standalone).
 *
 * @see docs/5.4.0-design-studio-first-standalone-voice-notes-suite-roadmap.md §3.2
 */

import type { RecorderState } from './voice-recorder';

/** Where the recorder UI is mounted — main agent may add contexts. */
export type RecorderHostContext = 'studio' | 'reddit' | 'standalone';

/**
 * Live preview frame pushed to Design Studio main preview during capture.
 * FABLE / MAIN AGENT: define payload (waveform samples, level, canvas snapshot, etc.).
 */
export interface LivePreviewFrame {
  timestamp: number;
}

export interface MountRecorderOptions {
  hostContext: RecorderHostContext;
  hostElement: HTMLElement;
  /** Reddit composer element when hostContext is 'reddit'. */
  composer?: Element | null;
  onStateChange?: (state: RecorderState) => void;
  onLivePreviewFrame?: (frame: LivePreviewFrame) => void;
  /** FABLE / MAIN AGENT: integrate with TakeManager on capture complete. */
  onTakeComplete?: (takeId: string) => void;
  onClose?: () => void;
}

export interface RecorderHostHandle {
  open(): void;
  close(): void;
  dispose(): void;
}

/**
 * Hostable recorder entry point — interface only in Phase 0.
 * FABLE / MAIN AGENT: implement; today use openRecorderPanel() directly.
 */
export type MountRecorder = (options: MountRecorderOptions) => RecorderHostHandle;