const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function safeProtobufNumber(value: bigint): number {
  if (value > MAX_SAFE_BIGINT) throw new Error("protobuf_integer_out_of_range");
  return Number(value);
}

export function readProtobufVarint(
  bytes: Uint8Array,
  start: number,
): { value: bigint; next: number } {
  if (!Number.isSafeInteger(start) || start < 0 || start >= bytes.length) {
    throw new Error("invalid_protobuf_varint");
  }
  let value = 0n;
  let shift = 0n;
  for (let offset = start; offset < bytes.length && offset < start + 10; offset += 1) {
    const current = bytes[offset];
    if (current === undefined) break;
    if (offset === start + 9 && current > 1) break;
    value |= BigInt(current & 0x7f) << shift;
    if ((current & 0x80) === 0) return { value, next: offset + 1 };
    shift += 7n;
  }
  throw new Error("invalid_protobuf_varint");
}

export function skipProtobufField(bytes: Uint8Array, offset: number, wireType: number): number {
  if (wireType === 0) return readProtobufVarint(bytes, offset).next;
  if (wireType === 1) {
    if (offset + 8 > bytes.length) throw new Error("invalid_protobuf_field");
    return offset + 8;
  }
  if (wireType === 2) {
    const length = readProtobufVarint(bytes, offset);
    const next = length.next + safeProtobufNumber(length.value);
    if (next > bytes.length) throw new Error("invalid_protobuf_field");
    return next;
  }
  if (wireType === 5) {
    if (offset + 4 > bytes.length) throw new Error("invalid_protobuf_field");
    return offset + 4;
  }
  throw new Error("invalid_protobuf_wire_type");
}
