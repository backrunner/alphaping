import { floorToFiveMinuteBlock, reportSlot } from "@alphaping/contracts";

export interface CheckBlockWrite {
  checkPk: number;
  workspacePk: number;
  nominalMinute: number;
  resultId: ArrayBuffer;
  payloadHash: ArrayBuffer;
  payload: ArrayBuffer;
  schemaVersion: number;
}

export function prepareCheckBlockWrite(input: CheckBlockWrite): {
  query: string;
  values: readonly (number | ArrayBuffer)[];
} {
  const blockStart = floorToFiveMinuteBlock(input.nominalMinute);
  const slot = reportSlot(input.nominalMinute);
  const resultColumn = `result_${slot}`;
  const idColumn = `result_id_${slot}`;
  const hashColumn = `payload_hash_${slot}`;

  return {
    query: `INSERT INTO check_result_blocks_5m
      (check_pk, workspace_pk, block_start, ${resultColumn}, ${idColumn}, ${hashColumn}, schema_version, flags)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(check_pk, block_start) DO UPDATE SET
        ${resultColumn} = excluded.${resultColumn},
        ${idColumn} = excluded.${idColumn},
        ${hashColumn} = excluded.${hashColumn},
        schema_version = excluded.schema_version
      WHERE check_result_blocks_5m.${idColumn} IS NULL
         OR (check_result_blocks_5m.${idColumn} = excluded.${idColumn}
             AND check_result_blocks_5m.${hashColumn} = excluded.${hashColumn})`,
    values: [
      input.checkPk,
      input.workspacePk,
      blockStart,
      input.payload,
      input.resultId,
      input.payloadHash,
      input.schemaVersion,
    ],
  };
}
