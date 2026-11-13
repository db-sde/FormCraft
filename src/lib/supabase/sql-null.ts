/**
 * A SQL NULL for a database function's argument. Postgres functions take
 * NULL for any argument, but the generated types (database.types.ts) can't
 * say so: they type every argument as non-null. Use this instead of
 * hand-editing the generated file, which CI regenerates and compares.
 */
export const SQL_NULL = null as unknown as string;
