import { floorToFiveMinuteBlock, reportSlot } from "@alphaping/contracts";

export interface TelemetryBlockWrite {
  machinePk: number;
  workspacePk: number;
  nominalMinute: number;
  reportId: ArrayBuffer;
  payloadHash: ArrayBuffer;
  payload: ArrayBuffer;
  schemaVersion: number;
}

export interface PreparedTelemetryBlockWrite {
  query: string;
  values: readonly (number | ArrayBuffer)[];
  blockStart: number;
  slot: 0 | 1 | 2 | 3 | 4;
}

export function prepareTelemetryBlockWrite(
  input: TelemetryBlockWrite,
): PreparedTelemetryBlockWrite {
  const blockStart = floorToFiveMinuteBlock(input.nominalMinute);
  const slot = reportSlot(input.nominalMinute);
  const reportColumn = `report_${slot}`;
  const idColumn = `report_id_${slot}`;
  const hashColumn = `payload_hash_${slot}`;

  return {
    blockStart,
    slot,
    query: `INSERT INTO telemetry_blocks_5m
      (machine_pk, workspace_pk, block_start, ${reportColumn}, ${idColumn}, ${hashColumn}, schema_version, flags)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(machine_pk, block_start) DO UPDATE SET
        ${reportColumn} = excluded.${reportColumn},
        ${idColumn} = excluded.${idColumn},
        ${hashColumn} = excluded.${hashColumn},
        schema_version = excluded.schema_version
      WHERE telemetry_blocks_5m.${idColumn} IS NULL
         OR (telemetry_blocks_5m.${idColumn} = excluded.${idColumn}
             AND telemetry_blocks_5m.${hashColumn} = excluded.${hashColumn})`,
    values: [
      input.machinePk,
      input.workspacePk,
      blockStart,
      input.payload,
      input.reportId,
      input.payloadHash,
      input.schemaVersion,
    ],
  };
}
