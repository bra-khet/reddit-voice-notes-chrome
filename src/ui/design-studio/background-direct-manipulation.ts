import {
  computeImageDrawSize,
  normalizeUserBackgroundLayout,
  type NormalizedUserBackgroundLayout,
} from '@/src/theme';
import {
  constrainPointOutsideBand,
  snapPosition,
  type NormalizedBand,
  type PositionSnapState,
} from '@/src/ui/design-studio/interaction-utils';

const POSITION_SAVE_DEBOUNCE_MS = 200;
const ZERO_SPAN_EPSILON = 0.0001;
const BACKGROUND_SNAP_STRENGTH_PX = 8;
const BACKGROUND_GUIDES = [0, 1 / 3, 0.5, 2 / 3, 1] as const;

export interface BackgroundImageSize {
  width: number;
  height: number;
}

export type BackgroundDragMode = 'pan' | 'focal';

export interface BackgroundDragGeometry {
  mode: BackgroundDragMode;
  layout: NormalizedUserBackgroundLayout;
  startPosition: { x: number; y: number };
  deltaClientX: number;
  deltaClientY: number;
  interactionWidth: number;
  interactionHeight: number;
  renderedCanvasWidth: number;
  renderedCanvasHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  imageSize: BackgroundImageSize | null;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function positionFromPanDelta(
  start: number,
  availableSpan: number,
  delta: number,
): number {
  if (Math.abs(availableSpan) < ZERO_SPAN_EPSILON) return start;
  return clampUnit((availableSpan * start + delta) / availableSpan);
}

export function computeDraggedBackgroundPosition({
  mode,
  layout,
  startPosition,
  deltaClientX,
  deltaClientY,
  interactionWidth,
  interactionHeight,
  renderedCanvasWidth,
  renderedCanvasHeight,
  canvasWidth,
  canvasHeight,
  imageSize,
}: BackgroundDragGeometry): { x: number; y: number } {
  if (mode === 'focal') {
    return {
      x: clampUnit(startPosition.x + deltaClientX / Math.max(1, interactionWidth)),
      y: clampUnit(startPosition.y + deltaClientY / Math.max(1, interactionHeight)),
    };
  }

  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
    // Metadata normally resolves before interaction. This fallback keeps physical
    // drag direction intuitive if an older ImageDB record has no dimensions.
    const direction = layout.scaleMode === 'fill' ? -1 : 1;
    return {
      x: clampUnit(startPosition.x + direction * deltaClientX / Math.max(1, interactionWidth)),
      y: clampUnit(startPosition.y + direction * deltaClientY / Math.max(1, interactionHeight)),
    };
  }

  const drawSize = computeImageDrawSize(
    canvasWidth,
    canvasHeight,
    imageSize.width,
    imageSize.height,
    layout.scaleMode,
    layout.manualScale,
  );
  const deltaCanvasX = deltaClientX * canvasWidth / Math.max(1, renderedCanvasWidth);
  const deltaCanvasY = deltaClientY * canvasHeight / Math.max(1, renderedCanvasHeight);

  // CHANGED: pan inverts the painter's exact offset equation for each axis.
  // WHY: dragging the image must track the pointer in both crop (negative span) and letterbox (positive span).
  return {
    x: positionFromPanDelta(
      startPosition.x,
      canvasWidth - drawSize.width,
      deltaCanvasX,
    ),
    y: positionFromPanDelta(
      startPosition.y,
      canvasHeight - drawSize.height,
      deltaCanvasY,
    ),
  };
}

export interface BackgroundZoomGeometry {
  layout: NormalizedUserBackgroundLayout;
  scaleFactor: number;
  anchor: { x: number; y: number };
  canvasWidth: number;
  canvasHeight: number;
  imageSize: BackgroundImageSize | null;
}

function anchoredPositionAfterScale(
  anchorPx: number,
  canvasSize: number,
  currentDrawSize: number,
  nextDrawSize: number,
  currentPosition: number,
): number {
  if (currentDrawSize <= 0) return currentPosition;
  const currentOffset = (canvasSize - currentDrawSize) * currentPosition;
  const imageCoordinate = (anchorPx - currentOffset) / currentDrawSize;
  const nextOffset = anchorPx - imageCoordinate * nextDrawSize;
  const nextSpan = canvasSize - nextDrawSize;
  if (Math.abs(nextSpan) < ZERO_SPAN_EPSILON) return currentPosition;
  return clampUnit(nextOffset / nextSpan);
}

export function computeZoomedBackgroundLayout({
  layout,
  scaleFactor,
  anchor,
  canvasWidth,
  canvasHeight,
  imageSize,
}: BackgroundZoomGeometry): NormalizedUserBackgroundLayout {
  const current = normalizeUserBackgroundLayout(layout);
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return current;
  const scaled = normalizeUserBackgroundLayout({
    ...current,
    manualScale: current.manualScale * scaleFactor,
  });
  if (
    !imageSize
    || imageSize.width <= 0
    || imageSize.height <= 0
    || canvasWidth <= 0
    || canvasHeight <= 0
  ) {
    return scaled;
  }
  const currentSize = computeImageDrawSize(
    canvasWidth,
    canvasHeight,
    imageSize.width,
    imageSize.height,
    current.scaleMode,
    current.manualScale,
  );
  const nextSize = computeImageDrawSize(
    canvasWidth,
    canvasHeight,
    imageSize.width,
    imageSize.height,
    scaled.scaleMode,
    scaled.manualScale,
  );
  // CHANGED: wheel zoom preserves the image point beneath the cursor while scale changes.
  // WHY: direct manipulation should feel like zooming a camera frame, not recentering a detached slider.
  return normalizeUserBackgroundLayout({
    ...scaled,
    customPosition: {
      x: anchoredPositionAfterScale(
        clampUnit(anchor.x) * canvasWidth,
        canvasWidth,
        currentSize.width,
        nextSize.width,
        current.customPosition.x,
      ),
      y: anchoredPositionAfterScale(
        clampUnit(anchor.y) * canvasHeight,
        canvasHeight,
        currentSize.height,
        nextSize.height,
        current.customPosition.y,
      ),
    },
  });
}

export interface BackgroundDirectManipulationDeps {
  resolveImageSize(id: string): Promise<BackgroundImageSize | null>;
  onInteractionStart(): void;
  onLayoutPreview(layout: NormalizedUserBackgroundLayout): void;
  persistLayout(layout: NormalizedUserBackgroundLayout): Promise<void>;
  onPersistError(error: unknown): void;
  isSnapEnabled?(): boolean;
  getCaptionSafeBand?(): NormalizedBand | null;
}

export interface BackgroundDirectManipulationHandle {
  sync(backgroundId: string | null, layout: NormalizedUserBackgroundLayout): void;
  setInteractionBlocked(blocked: boolean): void;
  flushPersist(): Promise<void>;
  dispose(): void;
}

export interface BackgroundDirectManipulationOptions {
  overlaySelector?: string;
  canvasSelector?: string;
  draggingClass?: string;
  resetEnabled?: boolean;
}

export function mountBackgroundDirectManipulation(
  root: HTMLElement,
  deps: BackgroundDirectManipulationDeps,
  options: BackgroundDirectManipulationOptions = {},
): BackgroundDirectManipulationHandle {
  // CHANGED: selectors and reset behavior are configurable for the Phase 2 mini preview.
  // WHY: hero and precision surfaces must share identical pointer/persistence semantics, not fork them.
  const overlaySelector = options.overlaySelector ?? '[data-background-manipulator]';
  const canvasSelector = options.canvasSelector
    ?? '.studio__hero [data-preview-canvas][data-preview-kind="primary"]';
  const draggingClass = options.draggingClass ?? 'studio__background-manipulator--dragging';
  const resetEnabled = options.resetEnabled ?? true;
  const overlay = root.querySelector<HTMLElement>(overlaySelector)!;
  const canvas = root.querySelector<HTMLCanvasElement>(canvasSelector)!;

  let backgroundId: string | null = null;
  let imageSize: BackgroundImageSize | null = null;
  let imageSizeGeneration = 0;
  let layout = normalizeUserBackgroundLayout(null);
  let activePointerId: number | null = null;
  let dragMode: BackgroundDragMode = 'pan';
  let dragStartClient = { x: 0, y: 0 };
  let dragStartPosition = { x: 0.5, y: 0.5 };
  let pendingPointer: { x: number; y: number; disableSnap: boolean } | null = null;
  let frameId = 0;
  let persistTimer = 0;
  let wheelGestureTimer = 0;
  let pendingPersistLayout: NormalizedUserBackgroundLayout | null = null;
  let persistChain = Promise.resolve();
  let disposed = false;
  let interactionBlocked = false;
  let snapState: PositionSnapState = {
    x: { snappedTo: null },
    y: { snappedTo: null },
  };

  function captionSafeBand(): NormalizedBand | null {
    return deps.getCaptionSafeBand?.() ?? null;
  }

  function updateActiveGuide(
    selector: string,
    value: number | null,
    property: 'left' | 'top',
  ): void {
    const guide = overlay.querySelector<HTMLElement>(selector);
    if (!guide) return;
    guide.hidden = value === null;
    if (value !== null) guide.style[property] = `${value * 100}%`;
  }

  function updateGuideOverlay(): void {
    const band = layout.lockToSafeText ? captionSafeBand() : null;
    const safeBand = overlay.querySelector<HTMLElement>('[data-background-caption-safe-band]');
    if (safeBand) {
      safeBand.hidden = !layout.lockToSafeText || !band;
      if (band) {
        const start = clampUnit(Math.min(band.start, band.end));
        const end = clampUnit(Math.max(band.start, band.end));
        safeBand.style.top = `${start * 100}%`;
        safeBand.style.height = `${Math.max(0, end - start) * 100}%`;
      }
    }
    updateActiveGuide('[data-background-active-guide-x]', snapState.x.snappedTo, 'left');
    updateActiveGuide('[data-background-active-guide-y]', snapState.y.snappedTo, 'top');
  }

  function updateFocalDot(): void {
    overlay.style.setProperty('--studio-background-focal-x', `${layout.customPosition.x * 100}%`);
    overlay.style.setProperty('--studio-background-focal-y', `${layout.customPosition.y * 100}%`);
    updateGuideOverlay();
  }

  function constrainInteractivePosition(
    raw: { x: number; y: number },
    interactionWidth: number,
    interactionHeight: number,
    disableSnap: boolean,
  ): { x: number; y: number } {
    let next = { x: clampUnit(raw.x), y: clampUnit(raw.y) };
    if ((deps.isSnapEnabled?.() ?? true) && !disableSnap) {
      const snapped = snapPosition(
        next,
        { x: BACKGROUND_GUIDES, y: BACKGROUND_GUIDES },
        {
          x: BACKGROUND_SNAP_STRENGTH_PX / Math.max(1, interactionWidth),
          y: BACKGROUND_SNAP_STRENGTH_PX / Math.max(1, interactionHeight),
        },
        snapState,
      );
      next = { x: snapped.x, y: snapped.y };
      snapState = {
        x: { snappedTo: snapped.snapped.x },
        y: { snappedTo: snapped.snapped.y },
      };
    } else {
      snapState = { x: { snappedTo: null }, y: { snappedTo: null } };
    }
    const band = layout.lockToSafeText ? captionSafeBand() : null;
    if (band) {
      const constrainedY = constrainPointOutsideBand(next.y, band);
      if (constrainedY !== next.y) snapState.y.snappedTo = null;
      next = { ...next, y: constrainedY };
    }
    updateGuideOverlay();
    return next;
  }

  function enqueuePersist(next: NormalizedUserBackgroundLayout): Promise<void> {
    persistChain = persistChain
      .then(() => deps.persistLayout(next))
      .catch((error: unknown) => {
        deps.onPersistError(error);
      });
    return persistChain;
  }

  function schedulePersistTimer(): void {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      const queued = pendingPersistLayout;
      pendingPersistLayout = null;
      if (queued) void enqueuePersist(queued);
    }, POSITION_SAVE_DEBOUNCE_MS);
  }

  function queuePersist(next: NormalizedUserBackgroundLayout): void {
    pendingPersistLayout = next;
    // CHANGED: storage starts only after pointer-up, with one trailing debounce per gesture.
    // WHY: an in-flight prefs response must never repaint an older position during the live drag.
    if (activePointerId === null) schedulePersistTimer();
  }

  async function flushPersist(): Promise<void> {
    if (persistTimer) {
      window.clearTimeout(persistTimer);
      persistTimer = 0;
    }
    const queued = pendingPersistLayout;
    pendingPersistLayout = null;
    if (wheelGestureTimer) {
      window.clearTimeout(wheelGestureTimer);
      wheelGestureTimer = 0;
    }
    if (queued) await enqueuePersist(queued);
    await persistChain;
  }

  function applyPointer(clientX: number, clientY: number, disableSnap: boolean): void {
    const interactionRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const rawPosition = computeDraggedBackgroundPosition({
      mode: dragMode,
      layout,
      startPosition: dragStartPosition,
      deltaClientX: clientX - dragStartClient.x,
      deltaClientY: clientY - dragStartClient.y,
      interactionWidth: interactionRect.width,
      interactionHeight: interactionRect.height,
      renderedCanvasWidth: canvasRect.width,
      renderedCanvasHeight: canvasRect.height,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      imageSize,
    });
    const customPosition = constrainInteractivePosition(
      rawPosition,
      interactionRect.width,
      interactionRect.height,
      disableSnap,
    );
    const next = normalizeUserBackgroundLayout({ ...layout, customPosition });
    if (
      next.customPosition.x === layout.customPosition.x
      && next.customPosition.y === layout.customPosition.y
    ) {
      return;
    }
    layout = next;
    updateFocalDot();
    deps.onLayoutPreview(layout);
    queuePersist(layout);
  }

  function flushFrame(): void {
    frameId = 0;
    const pointer = pendingPointer;
    pendingPointer = null;
    if (pointer) applyPointer(pointer.x, pointer.y, pointer.disableSnap);
  }

  function scheduleFrame(clientX: number, clientY: number, disableSnap: boolean): void {
    pendingPointer = { x: clientX, y: clientY, disableSnap };
    if (!frameId) frameId = requestAnimationFrame(flushFrame);
  }

  function finishGesture(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    pendingPointer = { x: event.clientX, y: event.clientY, disableSnap: event.shiftKey };
    if (frameId) cancelAnimationFrame(frameId);
    flushFrame();
    if (overlay.hasPointerCapture(event.pointerId)) {
      overlay.releasePointerCapture(event.pointerId);
    }
    activePointerId = null;
    overlay.classList.remove(draggingClass);
    if (pendingPersistLayout) schedulePersistTimer();
  }

  function resetPosition(): void {
    if (!backgroundId || interactionBlocked) return;
    deps.onInteractionStart();
    layout = normalizeUserBackgroundLayout({
      ...layout,
      position: 'center',
      customPosition: { x: 0.5, y: 0.5 },
    });
    snapState = { x: { snappedTo: null }, y: { snappedTo: null } };
    updateFocalDot();
    deps.onLayoutPreview(layout);
    pendingPersistLayout = layout;
    void flushPersist();
  }

  const pointerDownHandler = (event: PointerEvent): void => {
    if (
      disposed
      || interactionBlocked
      || !backgroundId
      || !event.isPrimary
      || event.button !== 0
    ) return;
    deps.onInteractionStart();
    if (persistTimer) {
      window.clearTimeout(persistTimer);
      persistTimer = 0;
    }
    activePointerId = event.pointerId;
    dragMode = (event.target as Element).closest('[data-background-focal-dot]')
      ? 'focal'
      : 'pan';
    dragStartClient = { x: event.clientX, y: event.clientY };
    dragStartPosition = { ...layout.customPosition };
    snapState = { x: { snappedTo: null }, y: { snappedTo: null } };
    pendingPointer = null;
    overlay.focus({ preventScroll: true });
    overlay.setPointerCapture(event.pointerId);
    overlay.classList.add(draggingClass);
    event.preventDefault();
  };

  const pointerMoveHandler = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    scheduleFrame(event.clientX, event.clientY, event.shiftKey);
    event.preventDefault();
  };

  const wheelHandler = (event: WheelEvent): void => {
    if (
      disposed
      || interactionBlocked
      || !backgroundId
      || !(event.ctrlKey || event.metaKey)
    ) return;
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
    event.preventDefault();
    if (!wheelGestureTimer) deps.onInteractionStart();
    else window.clearTimeout(wheelGestureTimer);
    wheelGestureTimer = window.setTimeout(() => {
      wheelGestureTimer = 0;
    }, POSITION_SAVE_DEBOUNCE_MS + 80);

    let next = computeZoomedBackgroundLayout({
      layout,
      scaleFactor: Math.exp(-event.deltaY * 0.0018),
      anchor: {
        x: (event.clientX - canvasRect.left) / canvasRect.width,
        y: (event.clientY - canvasRect.top) / canvasRect.height,
      },
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      imageSize,
    });
    const band = next.lockToSafeText ? captionSafeBand() : null;
    if (band) {
      next = normalizeUserBackgroundLayout({
        ...next,
        customPosition: {
          ...next.customPosition,
          y: constrainPointOutsideBand(next.customPosition.y, band),
        },
      });
    }
    if (
      next.manualScale === layout.manualScale
      && next.customPosition.x === layout.customPosition.x
      && next.customPosition.y === layout.customPosition.y
    ) {
      return;
    }
    snapState = { x: { snappedTo: null }, y: { snappedTo: null } };
    layout = next;
    updateFocalDot();
    deps.onLayoutPreview(layout);
    queuePersist(layout);
  };

  const doubleClickHandler = (event: MouseEvent): void => {
    if (interactionBlocked) return;
    event.preventDefault();
    resetPosition();
  };

  const keyDownHandler = (event: KeyboardEvent): void => {
    if (interactionBlocked || event.key !== 'Escape') return;
    event.preventDefault();
    if (activePointerId !== null && overlay.hasPointerCapture(activePointerId)) {
      overlay.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    pendingPointer = null;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    overlay.classList.remove(draggingClass);
    resetPosition();
  };

  overlay.addEventListener('pointerdown', pointerDownHandler);
  overlay.addEventListener('pointermove', pointerMoveHandler);
  overlay.addEventListener('pointerup', finishGesture);
  overlay.addEventListener('pointercancel', finishGesture);
  overlay.addEventListener('wheel', wheelHandler, { passive: false });
  if (resetEnabled) {
    overlay.addEventListener('dblclick', doubleClickHandler);
    overlay.addEventListener('keydown', keyDownHandler);
  }

  return {
    sync(nextBackgroundId, nextLayout): void {
      const idChanged = nextBackgroundId !== backgroundId;
      backgroundId = nextBackgroundId;
      layout = normalizeUserBackgroundLayout(nextLayout);
      if (idChanged || (activePointerId === null && !wheelGestureTimer)) {
        snapState = { x: { snappedTo: null }, y: { snappedTo: null } };
      }
      overlay.hidden = !backgroundId;
      updateFocalDot();
      if (!idChanged) return;

      const generation = ++imageSizeGeneration;
      imageSize = null;
      if (!backgroundId) {
        activePointerId = null;
        pendingPointer = null;
        overlay.classList.remove(draggingClass);
        return;
      }

      void deps.resolveImageSize(backgroundId)
        .then((resolved) => {
          if (!disposed && generation === imageSizeGeneration) imageSize = resolved;
        })
        .catch(() => {
          if (!disposed && generation === imageSizeGeneration) imageSize = null;
        });
    },

    setInteractionBlocked(blocked): void {
      if (interactionBlocked === blocked) return;
      interactionBlocked = blocked;
      // BUG FIX: eye-dropper clicks were captured by background pan/zoom
      // Fix: suspend every direct-manipulation entry point while the preview owns color sampling.
      // Sync: background-layout-controls.ts; mount-clip-studio.ts; scripts/test-background-control-ui.mjs
      if (!blocked) return;
      if (activePointerId !== null && overlay.hasPointerCapture(activePointerId)) {
        overlay.releasePointerCapture(activePointerId);
      }
      activePointerId = null;
      pendingPointer = null;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      overlay.classList.remove(draggingClass);
    },

    flushPersist,

    dispose(): void {
      disposed = true;
      imageSizeGeneration += 1;
      if (frameId) cancelAnimationFrame(frameId);
      if (persistTimer) window.clearTimeout(persistTimer);
      if (wheelGestureTimer) window.clearTimeout(wheelGestureTimer);
      overlay.removeEventListener('pointerdown', pointerDownHandler);
      overlay.removeEventListener('pointermove', pointerMoveHandler);
      overlay.removeEventListener('pointerup', finishGesture);
      overlay.removeEventListener('pointercancel', finishGesture);
      overlay.removeEventListener('wheel', wheelHandler);
      if (resetEnabled) {
        overlay.removeEventListener('dblclick', doubleClickHandler);
        overlay.removeEventListener('keydown', keyDownHandler);
      }
    },
  };
}
