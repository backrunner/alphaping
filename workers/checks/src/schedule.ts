export function dueSlot(nowMs: number, intervalSeconds: number, phaseSeconds: number): number {
  const nowSeconds = Math.floor(nowMs / 1_000);
  const shifted = nowSeconds - phaseSeconds;
  return Math.floor(shifted / intervalSeconds) * intervalSeconds + phaseSeconds;
}

export function isDue(
  nowMs: number,
  intervalSeconds: number,
  phaseSeconds: number,
  lastClaimedSlot: number,
): boolean {
  return dueSlot(nowMs, intervalSeconds, phaseSeconds) > lastClaimedSlot;
}
