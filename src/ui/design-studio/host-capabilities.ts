/*
 * Design Studio host capabilities.
 *
 * "Which host am I mounted on?" is a single, page-global, mount-time fact, so it
 * is set once from MountClipStudioOptions.hostCapabilities and read by the few UI
 * surfaces that render Reddit-only affordances (the workflow banner's CTA, the
 * status strip, the bake toast, the subtitle-controls bake message).
 *
 * WHY A TINY MODULE VALUE, NOT A THREADED PARAMETER
 * -------------------------------------------------
 * redditAttach is read from four unrelated surfaces, several of them deep in call
 * chains that have no other reason to know their host. Threading a boolean through
 * all of them would touch far more code than the fact justifies, and every new
 * Reddit-copy site would have to remember to plumb it. A mount-time set + read
 * keeps the seam to one import per site.
 *
 * DEFAULT IS THE EXTENSION'S BEHAVIOUR. `redditAttach` is true until a host says
 * otherwise, so a caller that passes no hostCapabilities (i.e. the extension) is
 * byte-identical to before this module existed — the Track D non-negotiable.
 *
 * Host-neutral (F3): no `browser.*`, no DOM, no I/O.
 */

let redditAttachEnabled = true;

/**
 * Apply a host's capability set. Called once by mountClipStudio from its options.
 * An absent field or an absent argument leaves the extension default (enabled).
 */
export function setStudioHostCapabilities(capabilities?: { redditAttach?: boolean }): void {
  redditAttachEnabled = capabilities?.redditAttach !== false;
}

/**
 * True when this host can attach a finished take to Reddit — i.e. the extension.
 * False on the hosted Design Studio, where there is no extension and no Reddit
 * tab to reach, so a "post to Reddit" affordance would be a dead control.
 */
export function isRedditAttachEnabled(): boolean {
  return redditAttachEnabled;
}
