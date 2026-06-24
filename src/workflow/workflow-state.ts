// Shared 3-phase workflow state — chrome.storage.local signal for cross-tab UX guidance.
// Authoritative recording/transcript state stays in subtitle-controls / IDB as before.
// This key carries the user's *intent* phase so both tabs can show contextual guidance.

export type WorkflowPhase = 'design' | 'capture' | 'polish';

export const WORKFLOW_PHASE_KEY = 'rvn.workflow.phase';

export function parseWorkflowPhase(raw: unknown): WorkflowPhase {
  if (raw === 'design' || raw === 'capture' || raw === 'polish') return raw;
  return 'design';
}

export async function getWorkflowPhase(): Promise<WorkflowPhase> {
  const result = await browser.storage.local.get(WORKFLOW_PHASE_KEY);
  return parseWorkflowPhase(result[WORKFLOW_PHASE_KEY]);
}

export async function setWorkflowPhase(phase: WorkflowPhase): Promise<void> {
  await browser.storage.local.set({ [WORKFLOW_PHASE_KEY]: phase });
}

export function onWorkflowPhaseChanged(
  callback: (phase: WorkflowPhase) => void,
): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    area: string,
  ) => {
    if (area !== 'local' || !(WORKFLOW_PHASE_KEY in changes)) return;
    callback(parseWorkflowPhase(changes[WORKFLOW_PHASE_KEY]?.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

// Opens or focuses the first matching Reddit tab; creates one if none found.
// Only callable from extension pages (requires browser.tabs).
export async function activateRedditTab(): Promise<void> {
  const tabs = await browser.tabs.query({
    url: ['*://www.reddit.com/*', '*://reddit.com/*'],
  });
  if (tabs.length > 0 && tabs[0].id != null) {
    await browser.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) {
      await browser.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    await browser.tabs.create({ url: 'https://www.reddit.com' });
  }
}
