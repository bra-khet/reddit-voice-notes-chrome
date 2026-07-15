export const BOUNDED_LIFE_GRID_MAX_DIMENSION = 64;
export const BOUNDED_LIFE_GRID_MAX_CELLS = 4096;

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(BOUNDED_LIFE_GRID_MAX_DIMENSION, Math.max(1, Math.floor(value)));
}

/**
 * CHANGED: Conway Life introduces one fixed-allocation binary B3/S23 lattice.
 * WHY: the stackable needs bounded generations and dead-edge neighbor reads without widening Digital Rain's directional activation grid into a general automaton.
 */
export class BoundedLifeGrid {
  readonly capacityColumns: number;
  readonly capacityRows: number;
  readonly capacity: number;

  private current: Uint8Array;
  private next: Uint8Array;
  private mutableGeneration = 0;

  constructor(capacityColumns: number, capacityRows: number) {
    const columns = normalizeDimension(capacityColumns);
    const requestedRows = normalizeDimension(capacityRows);
    this.capacityColumns = columns;
    this.capacityRows = Math.min(
      requestedRows,
      Math.max(1, Math.floor(BOUNDED_LIFE_GRID_MAX_CELLS / columns)),
    );
    this.capacity = this.capacityColumns * this.capacityRows;
    this.current = new Uint8Array(this.capacity);
    this.next = new Uint8Array(this.capacity);
  }

  get columns(): number {
    return this.capacityColumns;
  }

  get rows(): number {
    return this.capacityRows;
  }

  get generation(): number {
    return this.mutableGeneration;
  }

  clear(): void {
    this.current.fill(0);
    this.next.fill(0);
    this.mutableGeneration = 0;
  }

  isAlive(column: number, row: number): boolean {
    const index = this.indexOf(column, row);
    return index >= 0 && this.current[index] === 1;
  }

  setAlive(column: number, row: number, alive = true): boolean {
    const index = this.indexOf(column, row);
    if (index < 0) return false;
    this.current[index] = alive ? 1 : 0;
    return true;
  }

  neighborsAt(column: number, row: number): number {
    if (this.indexOf(column, row) < 0) return 0;
    let count = 0;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (columnOffset === 0 && rowOffset === 0) continue;
        if (this.isAlive(column + columnOffset, row + rowOffset)) count += 1;
      }
    }
    return count;
  }

  /** Advance exactly one Conway B3/S23 generation; out-of-bounds neighbors are dead. */
  step(): number {
    this.next.fill(0);
    let aliveCount = 0;
    for (let row = 0; row < this.capacityRows; row += 1) {
      for (let column = 0; column < this.capacityColumns; column += 1) {
        const index = this.storageIndex(column, row);
        const neighbors = this.neighborsAt(column, row);
        const alive = this.current[index] === 1;
        const nextAlive = neighbors === 3 || (alive && neighbors === 2);
        this.next[index] = nextAlive ? 1 : 0;
        if (nextAlive) aliveCount += 1;
      }
    }

    const previous = this.current;
    this.current = this.next;
    this.next = previous;
    this.mutableGeneration += 1;
    return aliveCount;
  }

  countAlive(): number {
    let count = 0;
    for (let row = 0; row < this.capacityRows; row += 1) {
      for (let column = 0; column < this.capacityColumns; column += 1) {
        if (this.current[this.storageIndex(column, row)] === 1) count += 1;
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
      || integerColumn >= this.capacityColumns
      || integerRow < 0
      || integerRow >= this.capacityRows
    ) return -1;
    return this.storageIndex(integerColumn, integerRow);
  }
}
