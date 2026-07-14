export const DEFAULT_SPATIAL_PARTITION_CELL_SIZE = 48;

export interface SpatialPoint {
  x: number;
  y: number;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/**
 * CHANGED: Phase 3 introduces a reusable, exact-radius spatial grid with caller-owned result buffers.
 * WHY: Forest Spirits needs local separation without an all-pairs agent scan or per-frame result arrays.
 */
export class SpatialPartition<T extends SpatialPoint> {
  readonly cellSize: number;

  private readonly cells = new Map<string, T[]>();
  private readonly activeBuckets: T[][] = [];

  constructor(cellSize = DEFAULT_SPATIAL_PARTITION_CELL_SIZE) {
    this.cellSize = finitePositive(cellSize, DEFAULT_SPATIAL_PARTITION_CELL_SIZE);
  }

  get occupiedCellCount(): number {
    return this.activeBuckets.length;
  }

  clear(): void {
    for (const bucket of this.activeBuckets) bucket.length = 0;
    this.activeBuckets.length = 0;
  }

  /** Bin one finite point. Invalid simulation state is rejected instead of poisoning a grid key. */
  insert(item: T): boolean {
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) return false;
    const column = Math.floor(item.x / this.cellSize);
    const row = Math.floor(item.y / this.cellSize);
    const key = cellKey(column, row);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    if (bucket.length === 0) this.activeBuckets.push(bucket);
    bucket.push(item);
    return true;
  }

  /**
   * Return exact-radius neighbors while reusing `target` when supplied.
   * The target is cleared first so one scratch array can serve every agent in a frame.
   */
  queryNeighbors(
    x: number,
    y: number,
    radius: number,
    target: T[] = [],
  ): T[] {
    target.length = 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return target;

    const safeRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
    const radiusSquared = safeRadius * safeRadius;
    const minColumn = Math.floor((x - safeRadius) / this.cellSize);
    const maxColumn = Math.floor((x + safeRadius) / this.cellSize);
    const minRow = Math.floor((y - safeRadius) / this.cellSize);
    const maxRow = Math.floor((y + safeRadius) / this.cellSize);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const bucket = this.cells.get(cellKey(column, row));
        if (!bucket?.length) continue;
        for (const item of bucket) {
          const dx = item.x - x;
          const dy = item.y - y;
          if (dx * dx + dy * dy <= radiusSquared) target.push(item);
        }
      }
    }
    return target;
  }
}
