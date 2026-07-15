import { describe, expect, it } from "vitest";

import { d1BlobToArrayBuffer } from "./d1-blob.js";

describe("D1 BLOB normalization", () => {
  it("normalizes D1 byte arrays and typed array views", () => {
    expect([...new Uint8Array(d1BlobToArrayBuffer([1, 2, 255]))]).toEqual([1, 2, 255]);
    expect([...new Uint8Array(d1BlobToArrayBuffer(new Uint8Array([3, 4])))]).toEqual([3, 4]);
  });

  it("rejects values outside the D1 BLOB boundary", () => {
    expect(() => d1BlobToArrayBuffer([1, -1])).toThrow("invalid_d1_blob");
    expect(() => d1BlobToArrayBuffer("secret")).toThrow("invalid_d1_blob");
  });
});
