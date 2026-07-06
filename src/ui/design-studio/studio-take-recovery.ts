/**
 * v5.4.0 — Studio tab return recovery after mid-processing close.
 *
 * When the Design Studio tab is closed during post-stop transcode, the
 * snapshot may stay 'processing' (async saveDraft on pagehide) while the
 * audition UI can orphan `active` without a host. On reopen we reconcile
 * against the background transcode queue and demote/promote the take.
 */

import {
  MSG_QUERY_TRANSCODE_INFLIGHT,
  type QueryTranscodeInflightResponse,
} from '@/src/messaging/types';
import { getTakeManager } from '@/src/session/take-manager';

async function isTranscodeInflight(): Promise<boolean> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: MSG_QUERY_TRANSCODE_INFLIGHT,
    })) as QueryTranscodeInflightResponse | undefined;
    return response?.ok === true && response.inflight === true;
  } catch {
    // Non-blocking — assume idle so the deck is not stuck on phantom processing.
    return false;
  }
}

/** Call once when the Studio shell mounts (and before opening a new audition). */
export async function reconcileStudioTakeAfterTabReturn(): Promise<void> {
  const inflight = await isTranscodeInflight();
  await getTakeManager().reconcileInterruptedProcessing({ transcodeInflight: inflight });
}