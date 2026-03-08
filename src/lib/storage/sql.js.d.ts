declare module "sql.js/dist/sql-wasm-browser.wasm?url" {
  const url: string;
  export default url;
}

declare module "sql.js" {
  export type BindParams = unknown[] | Record<string, unknown>;

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface Statement {
    bind(params?: BindParams): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }

  export interface Database {
    run(sql: string, params?: BindParams): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}
