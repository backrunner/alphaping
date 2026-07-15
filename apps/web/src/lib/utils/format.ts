export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
}

export function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

export function formatPercent(permille: number): string {
  return `${(permille / 10).toFixed(1)}%`;
}

export function formatRelativeTime(timestamp: number | null): string {
  if (timestamp === null) return "Never";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
