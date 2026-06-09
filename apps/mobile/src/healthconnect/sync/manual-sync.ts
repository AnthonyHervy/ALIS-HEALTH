import { normalizeApiBaseUrl } from '../../apiBaseUrl';
import { HealthConnectApi } from '../services/api';
import { buildHealthBatchFromRawRecords, RAW_RECORD_TYPES, SYNC_RECORD_TYPES } from '../services/health-connect';

type HealthConnectBridge = {
  initialize: () => Promise<boolean>;
  requestPermission: (permissions: Array<{ accessType: 'read'; recordType: string }>) => Promise<unknown[]>;
  readRecords: (
    recordType: any,
    options: {
      timeRangeFilter: { operator: 'between'; startTime: string; endTime: string };
      pageSize?: number;
      pageToken?: string;
    }
  ) => Promise<{ records?: any[]; pageToken?: string }>;
};

type ApiClient = {
  ingestHealthBatch: HealthConnectApi['ingestHealthBatch'];
};

type RecordReadPolicy = {
  maxHoursBack?: number;
  maxPages?: number;
};

type SyncInput = {
  apiBaseUrl: string | null;
  deviceToken: string | null;
  lastSyncAt?: string | null;
  syncTrigger?: 'manual' | 'background';
  networkType?: string | null;
  hoursBack?: number;
  now?: () => Date;
  healthConnect?: HealthConnectBridge;
  apiFactory?: (apiBaseUrl: string, deviceToken: string) => ApiClient;
};

export type ManualSyncResult = {
  syncedRecordCount: number;
  dataStart: string;
  dataEnd: string;
  syncMode: 'initial_full_history' | 'initial_30d' | 'incremental';
  failedRecordTypes?: string[];
};

function getDefaultHealthConnect(): HealthConnectBridge {
  const healthConnect = require('react-native-health-connect');
  return {
    initialize: healthConnect.initialize,
    requestPermission: healthConnect.requestPermission,
    readRecords: healthConnect.readRecords
  };
}

const defaultApiFactory = (apiBaseUrl: string, deviceToken: string) => new HealthConnectApi(apiBaseUrl, deviceToken);
const DEFAULT_SYNC_HOURS_BACK = 30 * 24;
const FULL_HISTORY_SYNC_HOURS_BACK = 3650 * 24;
const INCREMENTAL_SLEEP_LOOKBACK_HOURS = 48;
const HEALTH_CONNECT_PAGE_SIZE = 1000;
const HEALTH_CONNECT_RECORD_TYPE_TIMEOUT_MS = 30_000;
const DEFAULT_RECORD_TYPE_MAX_PAGES = 50;
const RECORD_READ_POLICIES: Record<string, RecordReadPolicy> = {
  HeartRate: { maxHoursBack: 36, maxPages: 4 },
  HeartRateVariabilityRmssd: { maxHoursBack: 35 * 24, maxPages: 6 },
  RestingHeartRate: { maxHoursBack: 35 * 24, maxPages: 6 },
  Vo2Max: { maxHoursBack: 35 * 24, maxPages: 6 }
};
const SPECIAL_READ_PERMISSIONS = [
  { accessType: 'read' as const, recordType: 'ReadHealthDataHistory' },
  { accessType: 'read' as const, recordType: 'BackgroundAccessPermission' }
];

function hasGrantedPermission(granted: unknown[], recordType: string) {
  return granted.some((permission) => {
    if (!permission || typeof permission !== 'object') {
      return false;
    }
    return (permission as { recordType?: string }).recordType === recordType;
  });
}

async function readAllRecords(
  healthConnect: HealthConnectBridge,
  recordType: string,
  timeRangeFilter: { operator: 'between'; startTime: string; endTime: string },
  maxPages: number
) {
  const records: any[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    const result = await withRecordTypeTimeout(
      recordType,
      healthConnect.readRecords(recordType, {
        timeRangeFilter,
        pageSize: HEALTH_CONNECT_PAGE_SIZE,
        ...(pageToken ? { pageToken } : {})
      })
    );
    pageCount += 1;
    if (Array.isArray(result.records)) {
      records.push(...result.records);
    }
    pageToken = result.pageToken;
  } while (pageToken && pageCount < maxPages);

  return records;
}

async function withRecordTypeTimeout<T>(recordType: string, promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Lecture Health Connect trop longue pour ${recordType}`)),
          HEALTH_CONNECT_RECORD_TYPE_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function applyRecordReadPolicy(
  recordType: string,
  timeRangeFilter: { operator: 'between'; startTime: string; endTime: string },
  end: Date
) {
  const policy = RECORD_READ_POLICIES[recordType];
  if (!policy?.maxHoursBack) {
    return timeRangeFilter;
  }

  const currentStart = new Date(timeRangeFilter.startTime).getTime();
  const minimumStart = end.getTime() - policy.maxHoursBack * 60 * 60 * 1000;
  return {
    ...timeRangeFilter,
    startTime: new Date(Math.max(currentStart, minimumStart)).toISOString()
  };
}

function recordTypeMaxPages(recordType: string) {
  return RECORD_READ_POLICIES[recordType]?.maxPages ?? DEFAULT_RECORD_TYPE_MAX_PAGES;
}

function healthSyncLog(level: 'info' | 'warn', message: string) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  console[level](message);
}

export async function performHealthConnectSync(input: SyncInput): Promise<ManualSyncResult> {
  if (!input.apiBaseUrl || !input.deviceToken) {
    throw new Error('Appareil non appairé. Appaire le téléphone avant de synchroniser.');
  }

  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const healthConnect = input.healthConnect ?? getDefaultHealthConnect();
  const apiFactory = input.apiFactory ?? defaultApiFactory;
  const end = (input.now ?? (() => new Date()))();

  const initialized = await healthConnect.initialize();
  if (!initialized) {
    throw new Error('Health Connect indisponible sur ce téléphone.');
  }

  const normalPermissions: Array<{ accessType: 'read'; recordType: string }> = RAW_RECORD_TYPES.map((recordType) => ({
    accessType: 'read' as const,
    recordType
  }));
  const permissions = [...normalPermissions, ...SPECIAL_READ_PERMISSIONS];
  const granted = await healthConnect.requestPermission(permissions);
  if (granted.length === 0) {
    throw new Error('Aucune permission Health Connect accordée.');
  }

  const hasHistoryAccess = hasGrantedPermission(granted, 'ReadHealthDataHistory');
  const syncMode = input.lastSyncAt
    ? 'incremental'
    : hasHistoryAccess
      ? 'initial_full_history'
      : 'initial_30d';
  const start = input.lastSyncAt
    ? new Date(input.lastSyncAt)
    : new Date(end.getTime() - (input.hoursBack ?? (hasHistoryAccess ? FULL_HISTORY_SYNC_HOURS_BACK : DEFAULT_SYNC_HOURS_BACK)) * 60 * 60 * 1000);
  const startTime = start.toISOString();
  const endTime = end.toISOString();
  const sleepStart = input.lastSyncAt
    ? new Date(start.getTime() - INCREMENTAL_SLEEP_LOOKBACK_HOURS * 60 * 60 * 1000)
    : start;
  const globalStartTime = new Date(Math.min(start.getTime(), sleepStart.getTime())).toISOString();
  const timeRangeFilterFor = (recordType: string) => ({
    operator: 'between' as const,
    startTime: recordType === 'SleepSession' ? sleepStart.toISOString() : startTime,
    endTime
  });

  const rawRecords: Record<string, any[]> = {};
  const failedRecordTypes: string[] = [];
  for (const recordType of SYNC_RECORD_TYPES) {
    const timeRangeFilter = applyRecordReadPolicy(recordType, timeRangeFilterFor(recordType), end);
    try {
      healthSyncLog(
        'info',
        `[ALIS Health Sync] Lecture ${recordType} ${timeRangeFilter.startTime} -> ${timeRangeFilter.endTime}`
      );
      rawRecords[recordType] = await readAllRecords(
        healthConnect,
        recordType,
        timeRangeFilter,
        recordTypeMaxPages(recordType)
      );
      healthSyncLog('info', `[ALIS Health Sync] ${recordType}: ${rawRecords[recordType].length} enregistrement(s)`);
    } catch (error) {
      rawRecords[recordType] = [];
      failedRecordTypes.push(recordType);
      healthSyncLog(
        'warn',
        `[ALIS Health Sync] ${recordType} ignore: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const batch = buildHealthBatchFromRawRecords(rawRecords, globalStartTime, endTime);
  batch.sync_trigger = input.syncTrigger ?? 'manual';
  batch.sync_mode = syncMode;
  if (input.networkType) {
    batch.network_type = input.networkType;
  }
  await apiFactory(apiBaseUrl, input.deviceToken).ingestHealthBatch(batch);

  const syncedRecordCount = Object.values(rawRecords).reduce((total, records) => total + records.length, 0);
  return {
    syncedRecordCount,
    dataStart: globalStartTime,
    dataEnd: endTime,
    syncMode,
    failedRecordTypes: failedRecordTypes.length > 0 ? failedRecordTypes.sort() : undefined
  };
}
