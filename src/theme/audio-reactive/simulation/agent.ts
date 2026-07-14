import type { SpatialPoint } from './spatial-partition';

export interface ReactiveAgent extends SpatialPoint {
  active: boolean;
  vx: number;
  vy: number;
}

export type ReactiveAgentFactory<T extends ReactiveAgent> = (index: number) => T;
export type ReactiveAgentActivator<T extends ReactiveAgent> = (agent: T, index: number) => void;

function normalizeCapacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

/**
 * CHANGED: simulations preallocate their maximum agent set and vary only the active prefix.
 * WHY: density hot-swaps must not allocate particle objects inside the capture RAF.
 */
export class ReactiveAgentPool<T extends ReactiveAgent> {
  readonly capacity: number;
  readonly agents: readonly T[];

  private mutableActiveCount = 0;

  constructor(capacity: number, factory: ReactiveAgentFactory<T>) {
    this.capacity = normalizeCapacity(capacity);
    this.agents = Array.from({ length: this.capacity }, (_, index) => {
      const agent = factory(index);
      agent.active = false;
      return agent;
    });
  }

  get activeCount(): number {
    return this.mutableActiveCount;
  }

  at(index: number): T | undefined {
    return this.agents[index];
  }

  /** Activate/deactivate a prefix, initializing only agents that newly enter the live set. */
  setActiveCount(count: number, activate?: ReactiveAgentActivator<T>): number {
    const requested = Number.isFinite(count) ? Math.floor(count) : 0;
    const nextCount = Math.min(this.capacity, Math.max(0, requested));

    for (let index = nextCount; index < this.mutableActiveCount; index += 1) {
      const agent = this.agents[index];
      if (agent) agent.active = false;
    }
    for (let index = this.mutableActiveCount; index < nextCount; index += 1) {
      const agent = this.agents[index];
      if (!agent) continue;
      agent.active = true;
      activate?.(agent, index);
    }

    this.mutableActiveCount = nextCount;
    return nextCount;
  }
}
