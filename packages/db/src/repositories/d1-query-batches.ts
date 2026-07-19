const D1_IN_BATCH_SIZE = 90;

export async function queryInBatches<Row, Value extends number | string = number | string>(
  database: D1Database,
  values: readonly Value[],
  prepare: (batch: readonly Value[]) => D1PreparedStatement,
): Promise<Row[]> {
  if (values.length === 0) return [];
  const statements = [];
  for (let offset = 0; offset < values.length; offset += D1_IN_BATCH_SIZE) {
    statements.push(prepare(values.slice(offset, offset + D1_IN_BATCH_SIZE)));
  }
  const results = await database.batch<Row>(statements);
  return results.flatMap((result) => result.results);
}

export async function queryEachInBatches<Row, Value extends number | string = number | string>(
  database: D1Database,
  values: readonly Value[],
  prepare: (value: Value) => D1PreparedStatement,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; offset < values.length; offset += D1_IN_BATCH_SIZE) {
    const statements = values.slice(offset, offset + D1_IN_BATCH_SIZE).map(prepare);
    const results = await database.batch<Row>(statements);
    rows.push(...results.flatMap((result) => result.results));
  }
  return rows;
}
