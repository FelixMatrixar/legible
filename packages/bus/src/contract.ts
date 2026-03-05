/** Driver-agnostic event-bus contract. Services only ever see this. */

export interface ConsumeOptions {
  pollMs?: number;
  batchSize?: number;
  signal?: AbortSignal;
}

export type Handler<T> = (msg: T, id: string) => Promise<void>;

export interface Bus {
  publish(topic: string, payload: unknown): Promise<unknown>;
  /** Runs forever (until signal abort); rejects only on unrecoverable failure. */
  consume<T>(
    topic: string,
    group: string,
    consumer: string,
    handler: Handler<T>,
    opts?: ConsumeOptions
  ): Promise<void>;
}
