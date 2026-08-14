export const BLOCK_MINUTES = 30;

export function toBlockCount(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("minutes must be finite and non-negative");
  return Math.ceil(minutes / BLOCK_MINUTES);
}

export function effectiveCapacityBlocks(blocks: number, bufferRatio: number): number {
  if (!Number.isInteger(blocks) || blocks < 0) throw new RangeError("blocks must be a non-negative integer");
  if (bufferRatio < 0 || bufferRatio >= 1) throw new RangeError("bufferRatio must be in [0, 1)");
  return Math.floor(blocks * (1 - bufferRatio));
}