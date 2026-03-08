export interface SqliteDatabase {
  execute(sql: string, params?: unknown[]): Promise<number>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
  close(): Promise<void>;
}

export interface SqliteProvider {
  readonly id: string;
  isAvailable(): boolean;
  open(path: string): Promise<SqliteDatabase>;
}
