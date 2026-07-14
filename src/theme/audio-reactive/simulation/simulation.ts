import {
  ReactiveAgentPool,
  type ReactiveAgent,
  type ReactiveAgentActivator,
  type ReactiveAgentFactory,
} from './agent';
import {
  DEFAULT_SPATIAL_PARTITION_CELL_SIZE,
  SpatialPartition,
} from './spatial-partition';

export interface AudioReactiveSimulationOptions<T extends ReactiveAgent> {
  capacity: number;
  createAgent: ReactiveAgentFactory<T>;
  cellSize?: number;
}

/**
 * CHANGED: the first Phase 3 overlay gets one small simulation owner for pool + neighbor index lifecycle.
 * WHY: Forest Spirits should rebuild local-neighbor state consistently without a speculative scene graph.
 */
export class AudioReactiveSimulation<T extends ReactiveAgent> {
  readonly pool: ReactiveAgentPool<T>;
  readonly partition: SpatialPartition<T>;

  constructor(options: AudioReactiveSimulationOptions<T>) {
    this.pool = new ReactiveAgentPool(options.capacity, options.createAgent);
    this.partition = new SpatialPartition(
      options.cellSize ?? DEFAULT_SPATIAL_PARTITION_CELL_SIZE,
    );
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  setActiveCount(count: number, activate?: ReactiveAgentActivator<T>): number {
    return this.pool.setActiveCount(count, activate);
  }

  rebuildSpatialIndex(): void {
    this.partition.clear();
    for (let index = 0; index < this.pool.activeCount; index += 1) {
      const agent = this.pool.at(index);
      if (agent?.active) this.partition.insert(agent);
    }
  }

  queryNeighbors(agent: T, radius: number, target: T[]): T[] {
    return this.partition.queryNeighbors(agent.x, agent.y, radius, target);
  }
}
