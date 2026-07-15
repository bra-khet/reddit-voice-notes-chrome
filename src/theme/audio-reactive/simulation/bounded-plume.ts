export const BOUNDED_PLUME_MAX_PLUMES = 16;
export const BOUNDED_PLUME_MAX_NODES_PER_PLUME = 16;
export const BOUNDED_PLUME_MAX_NODES = (
  BOUNDED_PLUME_MAX_PLUMES * BOUNDED_PLUME_MAX_NODES_PER_PLUME
);

export interface BoundedPlumeNode {
  active: boolean;
  age: number;
  lifetime: number;
}

export type BoundedPlumeNodeFactory<T extends BoundedPlumeNode> = (index: number) => T;
export type BoundedPlumeNodeInitializer<T extends BoundedPlumeNode> = (
  node: T,
  index: number,
  recycled: boolean,
) => void;

function normalizeDimension(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

function normalizeLimit(value: number, capacity: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(capacity, Math.max(0, Math.floor(value)));
}

/**
 * CHANGED: Layered Smoke gets a fixed set of per-plume history rings.
 * WHY: coherent smoke columns need ordered trail samples without allocating nodes in the capture RAF.
 */
export class BoundedPlumeField<T extends BoundedPlumeNode> {
  readonly plumeCapacity: number;
  readonly nodesPerPlume: number;
  readonly nodeCapacity: number;
  readonly nodes: readonly T[];

  private readonly cursors: Uint8Array;
  private mutablePlumeLimit: number;
  private mutableActiveCount = 0;

  constructor(
    plumeCapacity: number,
    nodesPerPlume: number,
    factory: BoundedPlumeNodeFactory<T>,
  ) {
    this.plumeCapacity = normalizeDimension(plumeCapacity, BOUNDED_PLUME_MAX_PLUMES);
    this.nodesPerPlume = normalizeDimension(
      nodesPerPlume,
      BOUNDED_PLUME_MAX_NODES_PER_PLUME,
    );
    this.nodeCapacity = this.plumeCapacity * this.nodesPerPlume;
    this.mutablePlumeLimit = this.plumeCapacity;
    this.cursors = new Uint8Array(this.plumeCapacity);
    this.nodes = Array.from({ length: this.nodeCapacity }, (_, index) => {
      const node = factory(index);
      node.active = false;
      node.age = 0;
      node.lifetime = Math.max(0.001, Number.isFinite(node.lifetime) ? node.lifetime : 1);
      return node;
    });
  }

  get plumeLimit(): number {
    return this.mutablePlumeLimit;
  }

  get activeCount(): number {
    return this.mutableActiveCount;
  }

  /** Lower or raise the live plume ceiling without changing the backing history rings. */
  configurePlumeLimit(limit: number): number {
    const nextLimit = normalizeLimit(limit, this.plumeCapacity);
    if (nextLimit < this.mutablePlumeLimit) {
      for (let plumeIndex = nextLimit; plumeIndex < this.mutablePlumeLimit; plumeIndex += 1) {
        this.clearPlume(plumeIndex);
      }
    }
    this.mutablePlumeLimit = nextLimit;
    return nextLimit;
  }

  /** Append one newest sample to a plume, recycling only that plume's oldest fixed slot. */
  append(plumeIndex: number, initialize: BoundedPlumeNodeInitializer<T>): T | null {
    if (!Number.isInteger(plumeIndex) || plumeIndex < 0 || plumeIndex >= this.mutablePlumeLimit) {
      return null;
    }
    const cursor = this.cursors[plumeIndex] ?? 0;
    const index = plumeIndex * this.nodesPerPlume + cursor;
    const node = this.nodes[index];
    if (!node) return null;

    const recycled = node.active;
    if (!recycled) this.mutableActiveCount += 1;
    node.active = true;
    node.age = 0;
    node.lifetime = 1;
    initialize(node, index, recycled);
    node.age = Math.max(0, Number.isFinite(node.age) ? node.age : 0);
    node.lifetime = Math.max(0.001, Number.isFinite(node.lifetime) ? node.lifetime : 1);
    this.cursors[plumeIndex] = (cursor + 1) % this.nodesPerPlume;
    return node;
  }

  /** Read a plume sample newest-first without exposing or allocating an ordered copy. */
  nodeAt(plumeIndex: number, offsetFromNewest: number): T | null {
    if (
      !Number.isInteger(plumeIndex)
      || plumeIndex < 0
      || plumeIndex >= this.mutablePlumeLimit
      || !Number.isInteger(offsetFromNewest)
      || offsetFromNewest < 0
      || offsetFromNewest >= this.nodesPerPlume
    ) {
      return null;
    }
    const cursor = this.cursors[plumeIndex] ?? 0;
    const localIndex = (
      cursor - 1 - offsetFromNewest + this.nodesPerPlume * 2
    ) % this.nodesPerPlume;
    return this.nodes[plumeIndex * this.nodesPerPlume + localIndex] ?? null;
  }

  /** Advance node ages and expire samples; plume motion remains consumer-owned. */
  advance(dt: number): void {
    const elapsed = Math.min(0.25, Math.max(0, Number.isFinite(dt) ? dt : 0));
    if (elapsed === 0) return;
    for (let plumeIndex = 0; plumeIndex < this.mutablePlumeLimit; plumeIndex += 1) {
      const start = plumeIndex * this.nodesPerPlume;
      for (let offset = 0; offset < this.nodesPerPlume; offset += 1) {
        const node = this.nodes[start + offset];
        if (!node?.active) continue;
        node.age += elapsed;
        if (node.age < node.lifetime) continue;
        node.active = false;
        this.mutableActiveCount -= 1;
      }
    }
  }

  clear(): void {
    for (const node of this.nodes) {
      node.active = false;
      node.age = 0;
    }
    this.cursors.fill(0);
    this.mutableActiveCount = 0;
  }

  private clearPlume(plumeIndex: number): void {
    const start = plumeIndex * this.nodesPerPlume;
    for (let offset = 0; offset < this.nodesPerPlume; offset += 1) {
      const node = this.nodes[start + offset];
      if (!node?.active) continue;
      node.active = false;
      node.age = 0;
      this.mutableActiveCount -= 1;
    }
    this.cursors[plumeIndex] = 0;
  }
}
