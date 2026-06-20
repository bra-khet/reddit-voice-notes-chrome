import { EXTENSION_LOG_PREFIX } from '@/src/utils/constants';
import { buildVoiceNoteFilename } from '@/src/utils/download';
import { walkDeepElements } from '@/src/utils/shadow-dom';
import { findVideoButton } from './composer-detection';
import { DROPZONE_SELECTORS } from './selectors';

export interface AttachResult {
  ok: boolean;
  message: string;
}

const REVEAL_INPUT_DELAY_MS = 400;

function scoreFileInput(input: HTMLInputElement): number {
  const accept = (input.accept ?? '').toLowerCase();
  let score = 0;
  if (accept.includes('video')) score += 10;
  if (accept.includes('mp4')) score += 8;
  if (accept.includes('mov')) score += 6;
  if (input.type === 'file') score += 2;
  if (!input.disabled) score += 1;
  return score;
}

/**
 * UPDATE WHEN REDDIT UI CHANGES
 * Locate a video file input inside a composer (includes Shadow DOM).
 */
export function findVideoFileInput(root: Element): HTMLInputElement | null {
  const candidates: Array<{ input: HTMLInputElement; score: number }> = [];

  walkDeepElements(root, (element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'file') return;
    candidates.push({ input: element, score: scoreFileInput(element) });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.input ?? null;
}

function assignFileToInput(input: HTMLInputElement, file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
}

function dispatchFileInputEvents(input: HTMLInputElement): void {
  const init = { bubbles: true, composed: true };
  input.dispatchEvent(new Event('input', init));
  input.dispatchEvent(new Event('change', init));
}

/**
 * UPDATE WHEN REDDIT UI CHANGES
 * Best-effort drop simulation for Reddit dropzones.
 */
function tryDropzoneAttach(root: Element, file: File): boolean {
  for (const selector of DROPZONE_SELECTORS) {
    let attached = false;

    walkDeepElements(root, (element) => {
      if (attached || !element.matches(selector)) return;

      const transfer = new DataTransfer();
      transfer.items.add(file);

      element.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, composed: true, dataTransfer: transfer }),
      );
      element.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, composed: true, dataTransfer: transfer }),
      );
      const dropped = element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, composed: true, dataTransfer: transfer }),
      );

      if (dropped) attached = true;
    });

    if (attached) return true;
  }

  return false;
}

async function revealVideoFileInput(composer: Element): Promise<HTMLInputElement | null> {
  let input = findVideoFileInput(composer);
  if (input) return input;

  const videoButton = findVideoButton(composer);
  if (!videoButton) return null;

  videoButton.click();
  await new Promise((resolve) => window.setTimeout(resolve, REVEAL_INPUT_DELAY_MS));

  input = findVideoFileInput(composer);
  if (input) return input;

  // Some Reddit flows mount the input on document.body after clicking video.
  input = findVideoFileInput(document.body);
  return input;
}

/**
 * Best-effort: attach an MP4 to Reddit's native video upload flow.
 * Download path is unaffected — caller handles fallback messaging.
 */
export async function attachMp4ToComposer(
  composer: Element,
  blob: Blob,
  filename?: string,
): Promise<AttachResult> {
  if (!document.contains(composer)) {
    return {
      ok: false,
      message:
        'Comment box is no longer on screen. Download the MP4 and upload it with Reddit’s video button.',
    };
  }

  const name = filename ?? buildVoiceNoteFilename('mp4');
  const file = new File([blob], name, { type: 'video/mp4', lastModified: Date.now() });

  const input = await revealVideoFileInput(composer);
  if (input) {
    try {
      assignFileToInput(input, file);
      dispatchFileInputEvents(input);

      console.log(`${EXTENSION_LOG_PREFIX} Attached MP4 via file input`, {
        filename: name,
        accept: input.accept,
      });

      return {
        ok: true,
        message: 'Video attached to your comment — review and post when ready.',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`${EXTENSION_LOG_PREFIX} File input attach failed`, detail);
    }
  }

  if (tryDropzoneAttach(composer, file)) {
    console.log(`${EXTENSION_LOG_PREFIX} Attached MP4 via dropzone`, { filename: name });
    return {
      ok: true,
      message: 'Video dropped into the comment box — review and post when ready.',
    };
  }

  return {
    ok: false,
    message:
      'Could not attach automatically. Download the MP4, click Reddit’s video button, and upload manually.',
  };
}