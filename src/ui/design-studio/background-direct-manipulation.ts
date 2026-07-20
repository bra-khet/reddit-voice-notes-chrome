import {
  computeImageDrawSize,
  normalizeUserBackgroundLayout,
  type NormalizedUserBackgroundLayout,
} from '@/src/theme';

const POSITION_SAVE_DEBOUNCE_MS = 200;
const ZERO_SPAN_EPSILON = 0.0001;

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

export interface BackgroundDirectManipulationDeps {
  resolveImageSize(id: string): Promise<BackgroundImageSize | null>;
  onInteractionStart(): void;
  onLayoutPreview(layout: NormalizedUserBackgroundLayout): void;
  persistLayout(layout: NormalizedUserBackgroundLayout): Promise<void>;
  onPersistError(error: unknown): void;
}

export interface BackgroundDirectManipulationHandle {
  sync(backgroundId: string | null, layout: NormalizedUserBackgroundLayout): void;
  flushPersist(): Promise<void>;
  dispose(): void;
}

export function mountBackgroundDirectManipulation(
  root: HTMLElement,
  deps: BackgroundDirectManipulationDeps,
): BackgroundDirectManipulationHandle {
  const overlay = root.querySelector<HTMLElement>('[data-background-manipulator]')!;
  const canvas = root.querySelector<HTMLCanvasElement>(
    '.studio__hero [data-preview-canvas][data-preview-kind="primary"]',
  )!;

  let backgroundId: string | null = null;
  let imageSize: BackgroundImageSize | null = null;
  let imageSizeGeneration = 0;
  let layout = normalizeUserBackgroundLayout(null);
  let activePointerId: number | null = null;
  let dragMode: BackgroundDragMode = 'pan';
  let dragStartClient = { x: 0, y: 0 };
  let dragStartPosition = { x: 0.5, y: 0.5 };
  let pendingPointer: { x: number; y: number } | null = null;
  let frameId = 0;
  let persistTimer = 0;
  let pendingPersistLayout: NormalizedUserBackgroundLayout | null = null;
  let persistChain = Promise.resolve();
  let disposed = false;

  function updateFocalDot(): void {
    overlay.style.setProperty('--studio-background-focal-x', `${layout.customPosition.x * 100}%`);
    overlay.style.setProperty('--studio-background-focal-y', `${layout.customPosition.y * 100}%`);
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
    if (queued) await enqueuePersist(queued);
    await persistChain;
  }

  function applyPointer(clientX: number, clientY: number): void {
    const interactionRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const customPosition = computeDraggedBackgroundPosition({
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
    if (pointer) applyPointer(pointer.x, pointer.y);
  }

  function scheduleFrame(clientX: number, clientY: number): void {
    pendingPointer = { x: clientX, y: clientY };
    if (!frameId) frameId = requestAnimationFrame(flushFrame);
  }

  function finishGesture(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    pendingPointer = { x: event.clientX, y: event.clientY };
    if (frameId) cancelAnimationFrame(frameId);
    flushFrame();
    if (overlay.hasPointerCapture(event.pointerId)) {
      overlay.releasePointerCapture(event.pointerId);
    }
    activePointerId = null;
    overlay.classList.remove('studio__background-manipulator--dragging');
    if (pendingPersistLayout) schedulePersistTimer();
  }

  function resetPosition(): void {
    if (!backgroundId) return;
    deps.onInteractionStart();
    layout = normalizeUserBackgroundLayout({
      ...layout,
      position: 'center',
      customPosition: { x: 0.5, y: 0.5 },
    });
    updateFocalDot();
    deps.onLayoutPreview(layout);
    pendingPersistLayout = layout;
    void flushPersist();
  }

  const pointerDownHandler = (event: PointerEvent): void => {
    if (disposed || !backgroundId || !event.isPrimary || event.button !== 0) return;
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
    pendingPointer = null;
    overlay.focus({ preventScroll: true });
    overlay.setPointerCapture(event.pointerId);
    overlay.classList.add('studio__background-manipulator--dragging');
    event.preventDefault();
  };

  const pointerMoveHandler = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    scheduleFrame(event.clientX, event.clientY);
    event.preventDefault();
  };

  const doubleClickHandler = (event: MouseEvent): void => {
    event.preventDefault();
    resetPosition();
  };

  const keyDownHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (activePointerId !== null && overlay.hasPointerCapture(activePointerId)) {
      overlay.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    pendingPointer = null;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    overlay.classList.remove('studio__background-manipulator--dragging');
    resetPosition();
  };

  overlay.addEventListener('pointerdown', pointerDownHandler);
  overlay.addEventListener('pointermove', pointerMoveHandler);
  overlay.addEventListener('pointerup', finishGesture);
  overlay.addEventListener('pointercancel', finishGesture);
  overlay.addEventListener('dblclick', doubleClickHandler);
  overlay.addEventListener('keydown', keyDownHandler);

  return {
    sync(nextBackgroundId, nextLayout): void {
      const idChanged = nextBackgroundId !== backgroundId;
      backgroundId = nextBackgroundId;
      layout = normalizeUserBackgroundLayout(nextLayout);
      overlay.hidden = !backgroundId;
      updateFocalDot();
      if (!idChanged) return;

      const generation = ++imageSizeGeneration;
      imageSize = null;
      if (!backgroundId) {
        activePointerId = null;
        pendingPointer = null;
        overlay.classList.remove('studio__background-manipulator--dragging');
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

    flushPersist,

    dispose(): void {
      disposed = true;
      imageSizeGeneration += 1;
      if (frameId) cancelAnimationFrame(frameId);
      if (persistTimer) window.clearTimeout(persistTimer);
      overlay.removeEventListener('pointerdown', pointerDownHandler);
      overlay.removeEventListener('pointermove', pointerMoveHandler);
      overlay.removeEventListener('pointerup', finishGesture);
      overlay.removeEventListener('pointercancel', finishGesture);
      overlay.removeEventListener('dblclick', doubleClickHandler);
      overlay.removeEventListener('keydown', keyDownHandler);
    },
  };
}
