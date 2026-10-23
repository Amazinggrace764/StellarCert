import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Per-contract-stream ingestion cursor.
 *
 * Each row tracks the last ledger that was fully persisted together with its events.
 * Cursor advancement is done in the same transaction as event insertion so a
 * restart neither loses events nor replays them into duplicate side effects.
 */
@Entity('stellar_event_checkpoints')
@Index('IDX_event_checkpoints_stream_key', ['streamKey'], { unique: true })
export class EventCheckpointEntity {
  @PrimaryGeneratedColumn('string')
  id: string;

  /**
   * Stable identifier for the consumed stream, e.g. `<contractId>:<topic0>`.
   * Unique so a given stream has exactly one cursor.
   */
  @Column({ type: 'varchar', length: 255 })
  streamKey: string;

  @Column({ type: 'varchar', length: 56 })
  contractId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  topic0: string | null;

  /**
   * Highest ledger whose events are durably persisted and committed.
   * Next ingestion attempt starts at `lastProcessedLedger + 1`.
   */
  @Column({ type: 'bigint', default: 0 })
  lastProcessedLedger: string;

  /**
   * Last ledger observed as closed/finalized by the network.
   * May be ahead of `lastProcessedLedger` while a range is being replayed.
   */
  @Column({ type: 'bigint', default: 0 })
  lastClosedLedger: string;

  /**
   * Ledger from which the next replay will resume. Null unless an operator
   * has requested a bounded replay. When set, ingestion will not advance
   * `lastProcessedLedger` beyond this point until the replay completes.
   */
  @Column({ type: 'bigint', nullable: true })
  replayFromLedger: string | null;

  @Column({ type: 'bigint', nullable: true })
  replayToLedger: string | null;

  /**
   * Consecutive failure count for the current ledger. Reset to zero on
   * successful commit. Used to drive backoff and dead-letter decisions.
   */
  @Column({ type: 'int', default: 0 })
  consecutiveFailures: number;

  /**
   * Last error message encountered while processing this stream. Null on
   * healthy streams. Surfaced via observability endpoints.
   */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastSuccessAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastFailureAt: Date | null;

  /**
   * When true the stream is paused by an operator (or automatically after
   * exceeding the dead-letter threshold) and will not be ingested until
   * resumed. Prevents toxic ledgers from hot-looping.
   */
  @Column({ type: 'boolean', default: false })
  halted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
