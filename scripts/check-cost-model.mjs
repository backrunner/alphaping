const MONTH_MINUTES = 43_200;
const FIVE_MINUTE_BUCKETS = MONTH_MINUTES / 5;
const HOUR_BUCKETS = MONTH_MINUTES / 60;
const D1_INCLUDED_WRITES = 50_000_000;
const D1_WRITE_PRICE_PER_MILLION = 1;
const D1_INCLUDED_STORAGE_GB = 5;
const D1_STORAGE_PRICE_PER_GB = 0.75;
const WORKERS_INCLUDED_REQUESTS = 10_000_000;
const WORKERS_REQUEST_PRICE_PER_MILLION = 0.3;
const IMPLEMENTATION_MARGIN = 1.25;

function writesPerMachine() {
  return (
    MONTH_MINUTES +
    FIVE_MINUTE_BUCKETS +
    MONTH_MINUTES +
    FIVE_MINUTE_BUCKETS * 2 +
    HOUR_BUCKETS * 2 +
    MONTH_MINUTES
  );
}

function writesPerCheck() {
  return writesPerMachine() + FIVE_MINUTE_BUCKETS * 2;
}

export function estimateScale(machines, checks) {
  const knownWrites = machines * writesPerMachine() + checks * writesPerCheck();
  const budgetedWrites = knownWrites * IMPLEMENTATION_MARGIN;
  const storageGb = machines * 0.0262 + checks * 0.0116 + 0.5;
  const workersRequests = machines * MONTH_MINUTES + MONTH_MINUTES;
  const d1WriteOverage =
    (Math.max(0, budgetedWrites - D1_INCLUDED_WRITES) / 1_000_000) * D1_WRITE_PRICE_PER_MILLION;
  const storageOverage = Math.max(0, storageGb - D1_INCLUDED_STORAGE_GB) * D1_STORAGE_PRICE_PER_GB;
  const requestOverage =
    (Math.max(0, workersRequests - WORKERS_INCLUDED_REQUESTS) / 1_000_000) *
    WORKERS_REQUEST_PRICE_PER_MILLION;
  return {
    machines,
    checks,
    knownWrites,
    budgetedWrites,
    storageGb,
    platformOverage: d1WriteOverage + storageOverage + requestOverage,
  };
}

function millions(value) {
  return `${(value / 1_000_000).toFixed(3)}m`;
}

const scales = [30, 100, 150, 200, 1_000].map((resources) => estimateScale(resources, resources));

console.table(
  scales.map((scale) => ({
    scale: `${scale.machines}+${scale.checks}`,
    knownWrites: millions(scale.knownWrites),
    budgetedWrites: millions(scale.budgetedWrites),
    storage: `${scale.storageGb.toFixed(3)} GB`,
    overage: `$${scale.platformOverage.toFixed(2)}`,
  })),
);

const baseline = estimateScale(100, 100);
if (baseline.budgetedWrites > D1_INCLUDED_WRITES || baseline.storageGb > D1_INCLUDED_STORAGE_GB) {
  throw new Error("100 machines + 100 checks no longer fit the Cloudflare Paid baseline");
}
if (writesPerMachine() !== 156_960 || writesPerCheck() !== 174_240) {
  throw new Error(
    `cost ledger drifted: ${writesPerMachine()} machine / ${writesPerCheck()} check writes`,
  );
}
