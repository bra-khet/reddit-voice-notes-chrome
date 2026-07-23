/*
 * Web host — the RELAY SLICE of entrypoints/background.ts, and nothing else.
 *
 * Track D Phase 1 (roadmap §3.3). The extension routes heavy media work across
 * three contexts:
 *
 *   Studio (tab)  --*_START-->  background (SW)  --*_OFFSCREEN-->  offscreen doc
 *                                                  <--PROGRESS/COMPLETE--
 *
 * The hosted Studio has exactly one context, so `entrypoints/offscreen/main.ts`
 * is imported in-page and this module plays the background's part over the
 * loopback bus in web-runtime.ts:
 *
 *   Studio  --*_START-->  [this file]  --ACK-->  Studio
 *                              |
 *                        *_OFFSCREEN
 *                              v
 *                   offscreen/main.ts (in-page)
 *                              |
 *              PROGRESS / COMPLETE (broadcast, seen directly)
 *                              v
 *                            Studio
 *
 * WHY A RELAY AND NOT A DIRECT CALL. Calling src/ffmpeg/ffmpeg-runner.ts
 * straight from the Studio would be shorter and would fork the contract: I5's
 * stall-timer semantics (heartbeats must NOT reset the client timer), the cancel
 * path, the transcode/transcribe queue interlock, and every progress-UI binding
 * live in the message layer. Keeping the messages keeps all of it, unmodified,
 * for both hosts. The relay is the cheap half of that trade.
 *
 * WHAT THIS FILE DELIBERATELY OMITS from background.ts's 1,500 lines:
 *   - tab bookkeeping / relay-tab session maps  — one context, no tabs
 *   - offscreen document lifecycle + ping/recycle — offscreen is a module here
 *   - keep-alive alarms                          — no service worker to keep alive
 *   - PROGRESS/COMPLETE re-broadcast             — see the guard below; this one
 *     is not an omission for brevity, it is a correctness requirement
 *
 * WHAT THIS FILE MUST STILL MIRROR (not optional):
 *   - Terminal transcribe persistence. Background owns `saveSessionTranscript`
 *     + `SESSION_TRANSCRIPT_READY_KEY` on every COMPLETE (BUG-038). Rule 6 says
 *     we must NOT re-broadcast COMPLETE on the loopback bus, but the Studio UI
 *     still loads captions from IDB + the ready signal — without that side
 *     effect Vosk can finish ("applied: true") while the panel stays Pending.
 *
 * ADR-0011 WATCH: this file must stay a RELAY. The moment it starts making
 * policy decisions the extension's background does not make, that divergence
 * needs an ADR, not a quiet edit.
 */

import {
  isOffscreenTarget,
  validateBurnInStartRequest,
  validateTranscodeStartRequest,
  validateTranscribeStartRequest,
} from '@/src/messaging/relay-validate';
import {
  MSG_BURNIN_ACK,
  MSG_BURNIN_CANCEL,
  MSG_BURNIN_COMPLETE,
  MSG_BURNIN_OFFSCREEN,
  MSG_BURNIN_START,
  MSG_TRANSCODE_ACK,
  MSG_TRANSCODE_CANCEL,
  MSG_TRANSCODE_COMPLETE,
  MSG_TRANSCODE_OFFSCREEN,
  MSG_TRANSCODE_START,
  MSG_TRANSCRIBE_ACK,
  MSG_TRANSCRIBE_CANCEL,
  MSG_TRANSCRIBE_COMPLETE,
  MSG_TRANSCRIBE_OFFSCREEN,
  MSG_TRANSCRIBE_START,
  type BurnInAckResponse,
  type BurnInCompleteMessage,
  type BurnInOffscreenRequest,
  type BurnInStartRequest,
  type TranscodeAckResponse,
  type TranscodeCancelRequest,
  type TranscodeCompleteMessage,
  type TranscodeOffscreenRequest,
  type TranscodeStartRequest,
  type TranscribeAckResponse,
  type TranscribeCancelRequest,
  type TranscribeCompleteMessage,
  type TranscribeOffscreenRequest,
  type TranscribeStartRequest,
} from '@/src/messaging/types';
import { SESSION_TRANSCRIPT_READY_KEY } from '@/src/settings/user-preferences';
import { saveSessionTranscript } from '@/src/storage/session-transcript-db';
import { TRANSCRIBE_TIMEOUT_MS } from '@/src/transcription/constants';
import { prepareTranscribeCompletionForPersistence } from '@/src/transcription/transcribe-completion';

const LOG_PREFIX = '[web-pipeline-host]';

// BUG FIX: hosted Vosk success never reached Design Studio transcript UI
// Fix: mirror background's terminal IDB + ready-key side effect on COMPLETE
//      without re-broadcasting COMPLETE (rule 6 / phantom-take guard).
// Sync: entrypoints/background.ts persistTranscribeCompletion + startTranscribeJobContext.
const TRANSCRIBE_COMPLETION_WATCHDOG_MS = TRANSCRIBE_TIMEOUT_MS + 5_000;

interface TranscribeJobContext {
  durationSeconds: number;
  language?: string;
  watchdog: ReturnType<typeof setTimeout>;
}

const transcribeContextByJobId = new Map<string, TranscribeJobContext>();

let offscreenModule: Promise<unknown> | null = null;

function normalizeTranscribeDuration(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function clearTranscribeJobContext(jobId: string): void {
  const context = transcribeContextByJobId.get(jobId);
  if (context) clearTimeout(context.watchdog);
  transcribeContextByJobId.delete(jobId);
}

function takeTranscribeJobContext(jobId: string): Omit<TranscribeJobContext, 'watchdog'> | null {
  const context = transcribeContextByJobId.get(jobId);
  if (!context) return null;
  clearTimeout(context.watchdog);
  transcribeContextByJobId.delete(jobId);
  return { durationSeconds: context.durationSeconds, language: context.language };
}

function startTranscribeJobContext(request: TranscribeStartRequest): void {
  clearTranscribeJobContext(request.jobId);
  const watchdog = setTimeout(() => {
    if (!transcribeContextByJobId.has(request.jobId)) return;
    // First delivery of a terminal COMPLETE (not a re-broadcast). Studio's
    // forkTranscribe listener and our COMPLETE handler both see it once.
    broadcastFailure({
      type: MSG_TRANSCRIBE_COMPLETE,
      jobId: request.jobId,
      ok: false,
      error: `Transcription timed out after ${Math.round(TRANSCRIBE_TIMEOUT_MS / 1000)}s`,
    });
    relayCancel(MSG_TRANSCRIBE_CANCEL, request.jobId);
  }, TRANSCRIBE_COMPLETION_WATCHDOG_MS);
  // Node test harness: don't keep the process alive for a 125 s idle timer.
  // Browsers ignore unref; production Completes clear the timer via take/clear.
  if (typeof (watchdog as { unref?: () => void }).unref === 'function') {
    (watchdog as { unref: () => void }).unref();
  }

  transcribeContextByJobId.set(request.jobId, {
    durationSeconds: normalizeTranscribeDuration(request.durationSeconds),
    language: request.language,
    watchdog,
  });
}

/**
 * Background's persistTranscribeCompletion, adapted for the single-context host.
 * Does NOT re-send COMPLETE — the Studio's forkTranscribe listener already saw
 * the offscreen broadcast on the loopback bus.
 */
async function persistTranscribeCompletion(
  message: TranscribeCompleteMessage,
  context: Omit<TranscribeJobContext, 'watchdog'>,
): Promise<void> {
  const prepared = prepareTranscribeCompletionForPersistence(
    message,
    context.durationSeconds,
    context.language,
  );
  if (!prepared) return;

  await saveSessionTranscript(prepared.result, message.jobId, prepared.meta);
  await browser.storage.local.set({ [SESSION_TRANSCRIPT_READY_KEY]: Date.now() });
}

function handleTranscribeComplete(message: TranscribeCompleteMessage): void {
  const context = takeTranscribeJobContext(message.jobId);
  if (!context) {
    console.warn(`${LOG_PREFIX} Ignoring stale transcribe completion`, { jobId: message.jobId });
    return;
  }
  void persistTranscribeCompletion(message, context).catch((error) => {
    console.warn(`${LOG_PREFIX} Terminal transcript persist failed`, {
      jobId: message.jobId,
      error,
    });
  });
}

/**
 * The web analogue of background.ts's ensureOffscreenDocument().
 *
 * The extension creates the offscreen document on first use and tears it down
 * when idle. A dynamic import gives the hosted Studio the same lifecycle shape,
 * and Vite splits offscreen/main.ts into its own chunk.
 *
 * Measured, so nobody over-credits this [V 2026-07-22]: the split chunk is
 * ~12 kB, NOT the whole engine graph. ffmpeg-runner is already statically
 * reachable from the Studio (subtitle-canvas-bake.ts imports runSubtitleBurnIn),
 * so it sits in the main chunk either way. The honest claim is that mounting the
 * pipeline added ~0 first-load bytes — not that it removed any. If the burn-in
 * import ever leaves the Studio's static graph, this lazy boundary is what lets
 * the 31 MB-adjacent engine code follow it out.
 *
 * Memoized on the PROMISE, not on completion: two jobs started back to back must
 * share one module instance, or offscreen registers its listener twice and every
 * broadcast doubles.
 */
function ensureOffscreenModule(): Promise<unknown> {
  offscreenModule ??= import('@/entrypoints/offscreen/main').catch((error) => {
    // Let the next job retry a transient chunk-load failure.
    offscreenModule = null;
    throw error;
  });
  return offscreenModule;
}

/**
 * Hand a `*_OFFSCREEN` request to the in-page offscreen module.
 *
 * The ack check is not ceremony. If offscreen failed to register its listener,
 * sendMessage resolves `undefined` on the loopback bus and the job would sit
 * silent until the client's 45 s ACK / 90 s absolute timers fire, reporting a
 * stall that never happened. Offscreen answers every `*_OFFSCREEN` request
 * synchronously, so its silence is diagnostic.
 */
async function dispatchToOffscreen(request: { type: string; jobId: string }): Promise<void> {
  await ensureOffscreenModule();

  const response = (await browser.runtime.sendMessage(request)) as
    | { ok?: boolean; jobId?: string }
    | undefined;

  if (!response?.ok) {
    throw new Error(
      'The media engine did not accept the job. Reload the Design Studio and try again.',
    );
  }
}

/**
 * Report a post-ACK relay failure as a terminal COMPLETE.
 *
 * Mirrors background.ts's relay*Failure(). Once the client has its ACK it is
 * committed to waiting for a COMPLETE, so a dispatch failure must be SPOKEN as
 * one — otherwise the only thing the user ever sees is a stall timeout 60 s
 * later, blaming the wrong layer.
 */
function broadcastFailure(
  message: TranscodeCompleteMessage | BurnInCompleteMessage | TranscribeCompleteMessage,
): void {
  void browser.runtime.sendMessage(message).catch(() => {
    /* No listener left — the Studio unmounted mid-job. */
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Forward a cancel to the offscreen module. Mirrors cancelOffscreenJob(). */
function relayCancel(type: string, jobId: string): void {
  void browser.runtime.sendMessage({ type, target: 'offscreen', jobId }).catch((error) => {
    console.warn(`${LOG_PREFIX} cancel relay failed`, jobId, error);
  });
}

export function installWebPipelineHost(): void {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null) return;

    // Already addressed to offscreen — offscreen/main.ts owns it. Relaying it
    // again would re-enter this listener forever, because on the loopback bus
    // sender and receiver are the same page.
    if (isOffscreenTarget(message)) return;

    const { type } = message as { type?: string };

    /*
     * PROGRESS and COMPLETE are NOT re-broadcast here, and that is load-bearing.
     * background.ts forwards them because the Studio lives in a different
     * context than the offscreen document. Here they are the same context, so
     * offscreen's broadcast already reaches the Studio's listener directly.
     * Forwarding would deliver every progress tick twice and every COMPLETE
     * twice — and a duplicate COMPLETE resolves a settled job, which is exactly
     * the class of bug that produces a phantom second take.
     *
     * Transcribe COMPLETE is still *handled* here for its terminal side effect
     * (IDB snapshot + ready key). That is not a re-broadcast.
     */
    if (type === MSG_TRANSCRIBE_COMPLETE) {
      handleTranscribeComplete(message as TranscribeCompleteMessage);
      return;
    }

    if (type === MSG_TRANSCODE_CANCEL) {
      const { jobId } = message as TranscodeCancelRequest;
      if (jobId) relayCancel(MSG_TRANSCODE_CANCEL, jobId);
      return;
    }

    if (type === MSG_TRANSCRIBE_CANCEL) {
      const { jobId } = message as TranscribeCancelRequest;
      if (jobId) relayCancel(MSG_TRANSCRIBE_CANCEL, jobId);
      return;
    }

    if (type === MSG_BURNIN_CANCEL) {
      // Burn-in shares the transcode cancel flag in offscreen/main.ts, so
      // background.ts routes it through cancelOffscreenJob(). Mirrored exactly.
      const { jobId } = message as { jobId?: string };
      if (jobId) relayCancel(MSG_TRANSCODE_CANCEL, jobId);
      return;
    }

    if (type === MSG_TRANSCODE_START) {
      const request = message as TranscodeStartRequest;
      void (async () => {
        let ackSent = false;
        try {
          validateTranscodeStartRequest(request);

          const ack: TranscodeAckResponse = {
            type: MSG_TRANSCODE_ACK,
            jobId: request.jobId,
            ok: true,
          };
          sendResponse(ack);
          ackSent = true;

          const offscreenRequest: TranscodeOffscreenRequest = {
            type: MSG_TRANSCODE_OFFSCREEN,
            target: 'offscreen',
            jobId: request.jobId,
            webmBase64: request.webmBase64,
            webmByteLength: request.webmByteLength,
            voiceEffect: request.voiceEffect,
          };
          await dispatchToOffscreen(offscreenRequest);
        } catch (error) {
          if (!ackSent) {
            sendResponse({
              type: MSG_TRANSCODE_ACK,
              jobId: request.jobId,
              ok: false,
              error: errorText(error),
            } satisfies TranscodeAckResponse);
            return;
          }
          broadcastFailure({
            type: MSG_TRANSCODE_COMPLETE,
            jobId: request.jobId,
            ok: false,
            error: errorText(error),
          });
        }
      })();
      return true;
    }

    if (type === MSG_BURNIN_START) {
      const request = message as BurnInStartRequest;
      void (async () => {
        let ackSent = false;
        try {
          validateBurnInStartRequest(request);

          const ack: BurnInAckResponse = {
            type: MSG_BURNIN_ACK,
            jobId: request.jobId,
            ok: true,
          };
          sendResponse(ack);
          ackSent = true;

          const offscreenRequest: BurnInOffscreenRequest = {
            type: MSG_BURNIN_OFFSCREEN,
            target: 'offscreen',
            jobId: request.jobId,
            mp4Base64: request.mp4Base64,
            mp4ByteLength: request.mp4ByteLength,
            segmentsJson: request.segmentsJson,
            styleJson: request.styleJson,
            videoDurationSeconds: request.videoDurationSeconds,
            themeBarColor: request.themeBarColor,
          };
          await dispatchToOffscreen(offscreenRequest);
        } catch (error) {
          if (!ackSent) {
            sendResponse({
              type: MSG_BURNIN_ACK,
              jobId: request.jobId,
              ok: false,
              error: errorText(error),
            } satisfies BurnInAckResponse);
            return;
          }
          broadcastFailure({
            type: MSG_BURNIN_COMPLETE,
            jobId: request.jobId,
            ok: false,
            error: errorText(error),
          });
        }
      })();
      return true;
    }

    if (type === MSG_TRANSCRIBE_START) {
      const request = message as TranscribeStartRequest;
      void (async () => {
        let ackSent = false;
        try {
          validateTranscribeStartRequest(request);
          // BUG FIX: hosted Vosk success never reached Design Studio transcript UI
          // Fix: retain duration/language + watchdog before ACK so every accepted
          //      COMPLETE can persist the IDB snapshot the Studio actually loads.
          // Sync: entrypoints/background.ts startTranscribeJobContext.
          startTranscribeJobContext(request);

          const ack: TranscribeAckResponse = {
            type: MSG_TRANSCRIBE_ACK,
            jobId: request.jobId,
            ok: true,
          };
          sendResponse(ack);
          ackSent = true;

          const offscreenRequest: TranscribeOffscreenRequest = {
            type: MSG_TRANSCRIBE_OFFSCREEN,
            target: 'offscreen',
            jobId: request.jobId,
            webmBase64: request.webmBase64,
            webmByteLength: request.webmByteLength,
            language: request.language,
          };
          await dispatchToOffscreen(offscreenRequest);
        } catch (error) {
          if (!ackSent) {
            clearTranscribeJobContext(request.jobId);
            sendResponse({
              type: MSG_TRANSCRIBE_ACK,
              jobId: request.jobId,
              ok: false,
              error: errorText(error),
            } satisfies TranscribeAckResponse);
            return;
          }
          // Post-ACK failure: broadcastFailure delivers COMPLETE once on the bus;
          // our COMPLETE handler above owns persistence + context cleanup.
          broadcastFailure({
            type: MSG_TRANSCRIBE_COMPLETE,
            jobId: request.jobId,
            ok: false,
            error: errorText(error),
          });
        }
      })();
      return true;
    }

    return;
  });
}
