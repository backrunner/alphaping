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
const REPORTS_PER_MACHINE_7D = 10_080;
const TYPICAL_CONTAINER_COUNT = 10;
const TYPICAL_REPORT_BYTES = 2 * 1024;
const MAX_CONTAINER_COUNT = 64;
const MAX_REPORT_BYTES = 8 * 1024;
const MACHINE_NON_RAW_STORAGE_GB =
  0.0262 - (REPORTS_PER_MACHINE_7D * TYPICAL_REPORT_BYTES) / 1_000_000_000;

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

function reportBytesForContainers(containersPerMachine) {
  const bounded = Math.max(0, Math.min(MAX_CONTAINER_COUNT, containersPerMachine));
  if (bounded <= TYPICAL_CONTAINER_COUNT) return TYPICAL_REPORT_BYTES;
  const ratio =
    (bounded - TYPICAL_CONTAINER_COUNT) / (MAX_CONTAINER_COUNT - TYPICAL_CONTAINER_COUNT);
  return TYPICAL_REPORT_BYTES + ratio * (MAX_REPORT_BYTES - TYPICAL_REPORT_BYTES);
}

export function estimateScale(
  machines,
  checks,
  { containersPerMachine = TYPICAL_CONTAINER_COUNT, catalogChangesPerDay = 0 } = {},
) {
  const catalogWrites =
    machines *
    catalogChangesPerDay *
    30 *
    (Math.min(MAX_CONTAINER_COUNT, containersPerMachine) * 2 + 1);
  const knownWrites = machines * writesPerMachine() + checks * writesPerCheck() + catalogWrites;
  const budgetedWrites = knownWrites * IMPLEMENTATION_MARGIN;
  const machineStorageGb =
    MACHINE_NON_RAW_STORAGE_GB +
    (REPORTS_PER_MACHINE_7D * reportBytesForContainers(containersPerMachine)) / 1_000_000_000;
  const storageGb = machines * machineStorageGb + checks * 0.0116 + 0.5;
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
    containersPerMachine,
    catalogWrites,
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
scales.push(
  estimateScale(100, 100, {
    containersPerMachine: 64,
    catalogChangesPerDay: 1,
  }),
);

console.table(
  scales.map((scale) => ({
    scale: `${scale.machines}+${scale.checks} / ${scale.containersPerMachine}c`,
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
const maximumContainerDensity = estimateScale(100, 100, {
  containersPerMachine: 64,
  catalogChangesPerDay: 1,
});
if (maximumContainerDensity.catalogWrites !== 387_000) {
  throw new Error(`container catalog ledger drifted: ${maximumContainerDensity.catalogWrites}`);
}
if (writesPerMachine() !== 156_960 || writesPerCheck() !== 174_240) {
  throw new Error(
    `cost ledger drifted: ${writesPerMachine()} machine / ${writesPerCheck()} check writes`,
  );
}
