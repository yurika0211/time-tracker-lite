declare module 'sql.js' {
  export interface Statement {
    bind(values?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    run(values?: unknown[]): void;
    free(): void;
  }

  export interface Database {
    prepare(sql: string): Statement;
    run(sql: string): void;
    export(): Uint8Array;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  const initSqlJs: (config?: InitSqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
