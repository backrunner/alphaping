const MONTH_MINUTES = 43_200;
const FIVE_MINUTE_BUCKETS = MONTH_MINUTES / 5;
const HOUR_BUCKETS = MONTH_MINUTES / 60;
const D1_INCLUDED_WRITES = 50_000_000;
const D1_WRITE_PRICE_PER_MILLION = 1;
const D1_INCLUDED_READS = 25_000_000_000;
const D1_READ_PRICE_PER_MILLION = 0.001;
const D1_INCLUDED_STORAGE_GB = 5;
const D1_STORAGE_PRICE_PER_GB = 0.75;
const WORKERS_INCLUDED_REQUESTS = 10_000_000;
const WORKERS_REQUEST_PRICE_PER_MILLION = 0.3;
const DO_INCLUDED_REQUESTS = 1_000_000;
const DO_REQUEST_PRICE_PER_MILLION = 0.15;
const R2_INCLUDED_CLASS_A_OPERATIONS = 1_000_000;
const IMPLEMENTATION_MARGIN = 1.25;
const REPORTS_PER_MACHINE_7D = 10_080;
const DASHBOARD_REQUESTS = 144_000;
const DASHBOARD_SESSIONS = 5;
const DASHBOARD_HOURS_PER_DAY = 8;
const DAYS_PER_MONTH = 30;
const VIEWER_REFRESH_SECONDS = 290;
const PUBLIC_STATUS_CACHE_TTL_SECONDS = 30;
const PUBLIC_STATUS_MAX_SERVICE_PAGES = 8;
const PUBLIC_STATUS_SERVICE_PAGE_SIZE = 25;
const PUBLIC_STATUS_MAX_MACHINES = 200;
const PUBLIC_STATUS_MAX_SERVICES = 200;
const PUBLIC_STATUS_CONTAINER_QUERY_LIMIT = 500;
const PUBLIC_STATUS_INCIDENT_LIMIT = 20;
const PUBLIC_STATUS_INCIDENT_SERVICE_LIMIT = 20;
const PUBLIC_STATUS_INCIDENT_UPDATE_LIMIT = 200;
const PUBLIC_STATUS_ANNOUNCEMENT_LIMIT = 20;
const PUBLIC_STATUS_BUCKETS_PER_SERVICE = (24 * 60) / 5 + 1;
const D1_IN_BATCH_SIZE = 90;
const TYPICAL_CONTAINER_COUNT = 10;
const TYPICAL_REPORT_BYTES = 2 * 1024;
const MAX_CONTAINER_COUNT = 64;
const MAX_REPORT_BYTES = 8 * 1024;
const HOURLY_RUNS = 720;
const CHECK_SCHEDULER_CURSOR_WRITES = 2 * MONTH_MINUTES;
const WORKSPACE_RETENTION_CURSOR_WRITES = 9 * HOURLY_RUNS;
const ARTIFACT_RETENTION_CURSOR_WRITES = 4 * HOURLY_RUNS;
const RETENTION_RUN_HISTORY_WRITES = 7 * HOURLY_RUNS;
const FIXED_RETENTION_WRITES =
  WORKSPACE_RETENTION_CURSOR_WRITES +
  ARTIFACT_RETENTION_CURSOR_WRITES +
  RETENTION_RUN_HISTORY_WRITES;
const R2_ARTIFACT_LIST_OPERATIONS = 2 * HOURLY_RUNS;
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

function liveRequests(machines) {
  const visibleTopics = Math.min(machines, DASHBOARD_SESSIONS);
  const agentConnections = machines * (MONTH_MINUTES / 10);
  const visibleSeconds = visibleTopics * DASHBOARD_HOURS_PER_DAY * DAYS_PER_MONTH * 3_600;
  const viewerConnections = Math.ceil(visibleSeconds / VIEWER_REFRESH_SECONDS);
  const agentFrames = visibleTopics * DASHBOARD_HOURS_PER_DAY * DAYS_PER_MONTH * (3_600 / 10);
  const demandRefreshes =
    visibleTopics * DASHBOARD_HOURS_PER_DAY * DAYS_PER_MONTH * (3_600 / 15) + viewerConnections;
  return {
    workerRequests: agentConnections + viewerConnections * 2,
    durableObjectRequests:
      agentConnections + viewerConnections + Math.ceil((agentFrames + demandRefreshes) / 20),
  };
}

function publicContainerQueryRows(machines, containersPerMachine) {
  const boundedContainers = Math.max(
    0,
    Math.min(MAX_CONTAINER_COUNT, Math.floor(containersPerMachine)),
  );
  let rows = 0;
  for (let offset = 0; offset < machines; offset += D1_IN_BATCH_SIZE) {
    const batchSize = Math.min(D1_IN_BATCH_SIZE, machines - offset);
    rows += Math.min(PUBLIC_STATUS_CONTAINER_QUERY_LIMIT, batchSize * boundedContainers);
  }
  return rows;
}

function publicStatusLedger(
  machines,
  checks,
  containersPerMachine,
  activeEdgeLocations,
  refreshesPerWindow,
) {
  const visibleMachines = Math.min(PUBLIC_STATUS_MAX_MACHINES, Math.max(0, machines));
  // The scale model assumes one check per service, matching the documented scale table.
  const visibleServices = Math.min(PUBLIC_STATUS_MAX_SERVICES, Math.max(0, checks));
  const incidentQueryBatches = Math.ceil(visibleServices / D1_IN_BATCH_SIZE);
  const incidentRows = visibleServices > 0 ? PUBLIC_STATUS_INCIDENT_LIMIT : 0;
  const fixedRowsPerProjection =
    1 +
    visibleMachines * 2 +
    publicContainerQueryRows(visibleMachines, containersPerMachine) +
    visibleServices * 4 +
    incidentQueryBatches * PUBLIC_STATUS_INCIDENT_LIMIT +
    incidentRows * Math.min(PUBLIC_STATUS_INCIDENT_SERVICE_LIMIT, visibleServices) +
    (incidentRows > 0 ? PUBLIC_STATUS_INCIDENT_UPDATE_LIMIT : 0) +
    PUBLIC_STATUS_ANNOUNCEMENT_LIMIT;
  const actualPageCount = Math.max(1, Math.ceil(visibleServices / PUBLIC_STATUS_SERVICE_PAGE_SIZE));
  let timelineRowsPerRefreshWindow = 0;
  for (
    let requestedPage = 1;
    requestedPage <= PUBLIC_STATUS_MAX_SERVICE_PAGES;
    requestedPage += 1
  ) {
    const actualPage = Math.min(requestedPage, actualPageCount);
    const pageOffset = (actualPage - 1) * PUBLIC_STATUS_SERVICE_PAGE_SIZE;
    const servicesOnPage = Math.max(
      0,
      Math.min(PUBLIC_STATUS_SERVICE_PAGE_SIZE, visibleServices - pageOffset),
    );
    timelineRowsPerRefreshWindow += servicesOnPage * PUBLIC_STATUS_BUCKETS_PER_SERVICE;
  }
  const boundedEdgeLocations = Math.max(0, Math.floor(activeEdgeLocations));
  const boundedRefreshesPerWindow = Math.max(1, Math.floor(refreshesPerWindow));
  const refreshWindows = (MONTH_MINUTES * 60) / PUBLIC_STATUS_CACHE_TTL_SECONDS;
  const routeCacheKeys = PUBLIC_STATUS_MAX_SERVICE_PAGES;
  const rowsPerRefreshWindow =
    fixedRowsPerProjection * routeCacheKeys + timelineRowsPerRefreshWindow;
  const liveProjections =
    refreshWindows * routeCacheKeys * boundedEdgeLocations * boundedRefreshesPerWindow;
  return {
    activeEdgeLocations: boundedEdgeLocations,
    refreshesPerWindow: boundedRefreshesPerWindow,
    routeCacheKeys,
    fixedRowsPerProjection,
    rowsPerRefreshWindow,
    liveProjections,
    readRows:
      rowsPerRefreshWindow * boundedEdgeLocations * boundedRefreshesPerWindow * refreshWindows,
    workerRequests: liveProjections,
  };
}

export function estimateScale(
  machines,
  checks,
  {
    containersPerMachine = TYPICAL_CONTAINER_COUNT,
    catalogChangesPerDay = 0,
    publicStatusActiveEdgeLocations = 1,
    publicStatusRefreshesPerWindow = 1,
  } = {},
) {
  const catalogWrites =
    machines *
    catalogChangesPerDay *
    30 *
    (Math.min(MAX_CONTAINER_COUNT, containersPerMachine) * 2 + 1);
  const knownWrites =
    machines * writesPerMachine() +
    checks * writesPerCheck() +
    catalogWrites +
    CHECK_SCHEDULER_CURSOR_WRITES +
    FIXED_RETENTION_WRITES;
  const budgetedWrites = knownWrites * IMPLEMENTATION_MARGIN;
  const publicStatus = publicStatusLedger(
    machines,
    checks,
    containersPerMachine,
    publicStatusActiveEdgeLocations,
    publicStatusRefreshesPerWindow,
  );
  const controlPlaneReads =
    DASHBOARD_REQUESTS * (machines + checks) +
    checks * MONTH_MINUTES * 2 +
    machines * MONTH_MINUTES * 5 +
    machines * MONTH_MINUTES * 2 +
    5_000_000;
  const modeledReads = controlPlaneReads + publicStatus.readRows;
  const machineStorageGb =
    MACHINE_NON_RAW_STORAGE_GB +
    (REPORTS_PER_MACHINE_7D * reportBytesForContainers(containersPerMachine)) / 1_000_000_000;
  const storageGb = machines * machineStorageGb + checks * 0.0116 + 0.5;
  const live = liveRequests(machines);
  const workersRequests =
    machines * MONTH_MINUTES +
    MONTH_MINUTES +
    DASHBOARD_REQUESTS +
    live.workerRequests +
    publicStatus.workerRequests;
  const d1WriteOverage =
    (Math.max(0, budgetedWrites - D1_INCLUDED_WRITES) / 1_000_000) * D1_WRITE_PRICE_PER_MILLION;
  const d1ReadOverage =
    (Math.max(0, modeledReads - D1_INCLUDED_READS) / 1_000_000) * D1_READ_PRICE_PER_MILLION;
  const storageOverage = Math.max(0, storageGb - D1_INCLUDED_STORAGE_GB) * D1_STORAGE_PRICE_PER_GB;
  const requestOverage =
    (Math.max(0, workersRequests - WORKERS_INCLUDED_REQUESTS) / 1_000_000) *
    WORKERS_REQUEST_PRICE_PER_MILLION;
  const durableObjectOverage =
    (Math.max(0, live.durableObjectRequests - DO_INCLUDED_REQUESTS) / 1_000_000) *
    DO_REQUEST_PRICE_PER_MILLION;
  return {
    machines,
    checks,
    containersPerMachine,
    catalogWrites,
    checkSchedulerCursorWrites: CHECK_SCHEDULER_CURSOR_WRITES,
    fixedRetentionWrites: FIXED_RETENTION_WRITES,
    r2ClassAOperations: R2_ARTIFACT_LIST_OPERATIONS,
    controlPlaneReads,
    publicStatusActiveEdgeLocations: publicStatus.activeEdgeLocations,
    publicStatusRefreshesPerWindow: publicStatus.refreshesPerWindow,
    publicStatusRouteCacheKeys: publicStatus.routeCacheKeys,
    publicStatusRowsPerRefreshWindow: publicStatus.rowsPerRefreshWindow,
    publicStatusLiveProjections: publicStatus.liveProjections,
    publicStatusReadRows: publicStatus.readRows,
    publicStatusWorkerRequests: publicStatus.workerRequests,
    knownWrites,
    budgetedWrites,
    modeledReads,
    storageGb,
    workersRequests,
    durableObjectRequests: live.durableObjectRequests,
    platformOverage:
      d1WriteOverage + d1ReadOverage + storageOverage + requestOverage + durableObjectOverage,
  };
}

function millions(value) {
  return `${(value / 1_000_000).toFixed(3)}m`;
}

const scales = [30, 100, 150, 200, 300, 1_000].map((resources) =>
  estimateScale(resources, resources),
);
scales.push(
  estimateScale(100, 100, {
    containersPerMachine: 64,
    catalogChangesPerDay: 1,
  }),
);
scales.push(
  estimateScale(100, 100, { publicStatusActiveEdgeLocations: 5 }),
  estimateScale(100, 100, { publicStatusActiveEdgeLocations: 20 }),
);

console.table(
  scales.map((scale) => ({
    scale: `${scale.machines}+${scale.checks} / ${scale.containersPerMachine}c / ${scale.publicStatusActiveEdgeLocations}e`,
    knownWrites: millions(scale.knownWrites),
    budgetedWrites: millions(scale.budgetedWrites),
    modeledReads: millions(scale.modeledReads),
    publicStatusReads: millions(scale.publicStatusReadRows),
    storage: `${scale.storageGb.toFixed(3)} GB`,
    requests: millions(scale.workersRequests),
    liveDoRequests: millions(scale.durableObjectRequests),
    r2ClassA: millions(scale.r2ClassAOperations),
    overage: `$${scale.platformOverage.toFixed(2)}`,
  })),
);

const baseline = estimateScale(100, 100);
if (
  baseline.budgetedWrites > D1_INCLUDED_WRITES ||
  baseline.modeledReads > D1_INCLUDED_READS ||
  baseline.storageGb > D1_INCLUDED_STORAGE_GB
) {
  throw new Error("100 machines + 100 checks no longer fit the Cloudflare Paid baseline");
}
if (baseline.workersRequests !== 5_660_194 || baseline.durableObjectRequests !== 483_642) {
  throw new Error(
    `live request ledger drifted: ${baseline.workersRequests} Worker / ${baseline.durableObjectRequests} DO requests`,
  );
}
if (
  baseline.controlPlaneReads !== 72_680_000 ||
  baseline.publicStatusRouteCacheKeys !== 8 ||
  baseline.publicStatusRowsPerRefreshWindow !== 72_688 ||
  baseline.publicStatusLiveProjections !== 691_200 ||
  baseline.publicStatusReadRows !== 6_280_243_200 ||
  baseline.modeledReads !== 6_352_923_200
) {
  throw new Error(`D1 read ledger drifted: ${baseline.modeledReads}`);
}
const regionalPublicStatus = estimateScale(100, 100, {
  publicStatusActiveEdgeLocations: 5,
});
if (
  regionalPublicStatus.publicStatusReadRows !== 31_401_216_000 ||
  regionalPublicStatus.workersRequests !== 8_424_994 ||
  regionalPublicStatus.platformOverage < 6.47 ||
  regionalPublicStatus.platformOverage > 6.48
) {
  throw new Error("regional public status cost ledger drifted");
}
const publicStatusRefreshBurst = estimateScale(100, 100, {
  publicStatusRefreshesPerWindow: 2,
});
if (
  publicStatusRefreshBurst.publicStatusReadRows !== 12_560_486_400 ||
  publicStatusRefreshBurst.publicStatusWorkerRequests !== 1_382_400 ||
  publicStatusRefreshBurst.modeledReads !== 12_633_166_400
) {
  throw new Error("public status refresh burst ledger drifted");
}
if (
  baseline.checkSchedulerCursorWrites !== 86_400 ||
  baseline.fixedRetentionWrites !== 14_400 ||
  baseline.r2ClassAOperations !== 1_440 ||
  baseline.r2ClassAOperations > R2_INCLUDED_CLASS_A_OPERATIONS
) {
  throw new Error("scheduler or retention operation ledger drifted");
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
