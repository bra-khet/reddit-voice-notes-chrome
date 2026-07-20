export const BOUNDED_ACTIVATION_GRID_MAX_DIMENSION = 64;
export const BOUNDED_ACTIVATION_GRID_MAX_CELLS = 4096;

export type GridPropagationDirection = 'down' | 'up' | 'right' | 'left';

export interface GridPropagationOptions {
  direction: GridPropagationDirection;
  /** Fraction of each activation retained in its current cell. */
  decay: number;
  /** Fraction copied into the next cell along the propagation axis. */
  transfer: number;
  /** Fraction copied into each forward-diagonal neighbor. */
  spread?: number;
  /** Values below this floor are discarded after a step. */
  threshold?: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(BOUNDED_ACTIVATION_GRID_MAX_DIMENSION, Math.max(1, Math.floor(value)));
}

/**
 * CHANGED: Digital Rain introduces one preallocated, direction-aware activation lattice.
 * WHY: glyph energy needs bounded local propagation without per-frame cell objects or a speculative CA framework.
 */
export class BoundedActivationGrid {
  readonly capacityColumns: number;
  readonly capacityRows: number;
  readonly capacity: number;

  private current: Float32Array;
  private next: Float32Array;
  private mutableColumns = 1;
  private mutableRows = 1;

  constructor(capacityColumns: number, capacityRows: number) {
    const columns = normalizeDimension(capacityColumns);
    const requestedRows = normalizeDimension(capacityRows);
    this.capacityColumns = columns;
    this.capacityRows = Math.min(
      requestedRows,
      Math.max(1, Math.floor(BOUNDED_ACTIVATION_GRID_MAX_CELLS / columns)),
    );
    this.capacity = this.capacityColumns * this.capacityRows;
    this.current = new Float32Array(this.capacity);
    this.next = new Float32Array(this.capacity);
    this.mutableColumns = this.capacityColumns;
    this.mutableRows = this.capacityRows;
  }

  get columns(): number {
    return this.mutableColumns;
  }

  get rows(): number {
    return this.mutableRows;
  }

  /** Resize the active rectangle inside the fixed allocation; dimension changes clear stale topology. */
  configure(columns: number, rows: number): boolean {
    const nextColumns = Math.min(this.capacityColumns, normalizeDimension(columns));
    const nextRows = Math.min(this.capacityRows, normalizeDimension(rows));
    if (nextColumns === this.mutableColumns && nextRows === this.mutableRows) return false;
    this.mutableColumns = nextColumns;
    this.mutableRows = nextRows;
    this.clear();
    return true;
  }

  clear(): void {
    this.current.fill(0);
    this.next.fill(0);
  }

  valueAt(column: number, row: number): number {
    const index = this.indexOf(column, row);
    return index < 0 ? 0 : this.current[index] ?? 0;
  }

  /** Max-blend one finite activation into an in-bounds cell. */
  activate(column: number, row: number, strength = 1): boolean {
    const index = this.indexOf(column, row);
    if (index < 0 || !Number.isFinite(strength)) return false;
    this.current[index] = Math.max(this.current[index] ?? 0, clamp01(strength));
    return true;
  }

  /** Advance one local propagation generation using the two preallocated buffers. */
  propagate(options: GridPropagationOptions): void {
    const decay = clamp01(options.decay);
    const transfer = clamp01(options.transfer);
    const spread = clamp01(options.spread ?? 0);
    const threshold = Math.min(0.25, clamp01(options.threshold ?? 0.002));
    const vertical = options.direction === 'down' || options.direction === 'up';
    const direction = options.direction === 'up' || options.direction === 'left' ? -1 : 1;
    this.next.fill(0);

    for (let row = 0; row < this.mutableRows; row += 1) {
      for (let column = 0; column < this.mutableColumns; column += 1) {
        const sourceIndex = this.storageIndex(column, row);
        const value = this.current[sourceIndex] ?? 0;
        if (value <= 0) continue;
        this.addNext(column, row, value * decay);

        const forwardColumn = vertical ? column : column + direction;
        const forwardRow = vertical ? row + direction : row;
        this.addNext(forwardColumn, forwardRow, value * transfer);
        if (spread > 0) {
          if (vertical) {
            this.addNext(column - 1, forwardRow, value * spread);
            this.addNext(column + 1, forwardRow, value * spread);
          } else {
            this.addNext(forwardColumn, row - 1, value * spread);
            this.addNext(forwardColumn, row + 1, value * spread);
          }
        }
      }
    }

    for (let row = 0; row < this.mutableRows; row += 1) {
      for (let column = 0; column < this.mutableColumns; column += 1) {
        const index = this.storageIndex(column, row);
        const value = this.next[index] ?? 0;
        if (value < threshold) this.next[index] = 0;
        else if (value > 1) this.next[index] = 1;
      }
    }

    const previous = this.current;
    this.current = this.next;
    this.next = previous;
  }

  countActive(threshold = 0.002): number {
    const floor = clamp01(threshold);
    let count = 0;
    for (let row = 0; row < this.mutableRows; row += 1) {
      for (let column = 0; column < this.mutableColumns; column += 1) {
        // BUG FIX: A zero threshold counted inactive grid cells as active
        // Fix: Require activation to be strictly above the requested floor, including a zero floor.
        if ((this.current[this.storageIndex(column, row)] ?? 0) > floor) count += 1;
      }
    }
    return count;
  }

  private storageIndex(column: number, row: number): number {
    return row * this.capacityColumns + column;
  }

  private indexOf(column: number, row: number): number {
    if (!Number.isFinite(column) || !Number.isFinite(row)) return -1;
    const integerColumn = Math.floor(column);
    const integerRow = Math.floor(row);
    if (
      integerColumn < 0
      || integerColumn >= this.mutableColumns
      || integerRow < 0
      || integerRow >= this.mutableRows
    ) return -1;
    return this.storageIndex(integerColumn, integerRow);
  }

  private addNext(column: number, row: number, value: number): void {
    const index = this.indexOf(column, row);
    if (index < 0 || value <= 0) return;
    this.next[index] = (this.next[index] ?? 0) + value;
  }
}
