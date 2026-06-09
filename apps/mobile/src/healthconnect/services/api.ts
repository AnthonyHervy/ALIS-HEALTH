import { normalizeApiBaseUrl } from '../../apiBaseUrl';
import type { HealthBatchRequest } from '../types';

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const HEALTH_INGEST_TIMEOUT_MS = 120000;
const MAX_HEALTH_INGEST_BODY_BYTES = 240_000;
const HEALTH_INGEST_ARRAY_CHUNK_SIZE = 500;
const HEALTH_INGEST_RAW_RECORD_CHUNK_SIZE = 500;

const HEALTH_BATCH_ARRAY_FIELDS = [
  'heart_rate',
  'hrv',
  'steps',
  'sleep',
  'workouts',
  'calories',
  'distance',
  'blood_glucose',
  'resting_heart_rate',
  'body_temperature',
  'vo2_max',
  'weight',
  'nutrition',
  'hydration'
] as const;

function healthApiLog(level: 'info' | 'warn', message: string) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  console[level](message);
}

function isNetworkRequestFailure(error: unknown) {
  return error instanceof Error && /Network request failed/i.test(error.message);
}

function isRetriableIngestError(error: unknown) {
  return (
    isNetworkRequestFailure(error) ||
    (error instanceof Error && /(prend trop de temps|Impossible de joindre|timed out|timeout)/i.test(error.message))
  );
}

function compactMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const value = metadata as Record<string, unknown>;
  const compact: Record<string, unknown> = {};
  for (const key of ['id', 'dataOrigin', 'clientRecordId']) {
    if (value[key] != null) {
      compact[key] = value[key];
    }
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactRecordForRetry(record: unknown) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }
  const value = record as Record<string, unknown>;
  const metadata = compactMetadata(value.metadata);
  if (!metadata && !('metadata' in value)) {
    return record;
  }
  const { metadata: _metadata, ...rest } = value;
  return metadata ? { ...rest, metadata } : rest;
}

function compactBatchForNetworkRetry(batch: HealthBatchRequest): HealthBatchRequest {
  const compact: Record<string, unknown> = { ...batch };
  delete compact.raw_records;
  for (const [key, value] of Object.entries(compact)) {
    if (Array.isArray(value)) {
      compact[key] = value.map(compactRecordForRetry);
    }
  }
  return compact as HealthBatchRequest;
}

function baseBatchFields(batch: HealthBatchRequest): HealthBatchRequest {
  return {
    source_type: batch.source_type,
    device_name: batch.device_name,
    device_id: batch.device_id,
    data_start: batch.data_start,
    data_end: batch.data_end,
    sync_trigger: batch.sync_trigger,
    sync_mode: batch.sync_mode,
    network_type: batch.network_type
  };
}

function splitHealthBatch(batch: HealthBatchRequest): HealthBatchRequest[] {
  const base = baseBatchFields(batch);
  const chunks: HealthBatchRequest[] = [];

  for (const field of HEALTH_BATCH_ARRAY_FIELDS) {
    const records = batch[field];
    if (!Array.isArray(records) || records.length === 0) {
      continue;
    }
    for (let index = 0; index < records.length; index += HEALTH_INGEST_ARRAY_CHUNK_SIZE) {
      chunks.push({
        ...base,
        [field]: records.slice(index, index + HEALTH_INGEST_ARRAY_CHUNK_SIZE)
      } as HealthBatchRequest);
    }
  }

  for (const [recordType, records] of Object.entries(batch.raw_records ?? {})) {
    if (!Array.isArray(records) || records.length === 0) {
      continue;
    }
    for (let index = 0; index < records.length; index += HEALTH_INGEST_RAW_RECORD_CHUNK_SIZE) {
      chunks.push({
        ...base,
        raw_records: {
          [recordType]: records.slice(index, index + HEALTH_INGEST_RAW_RECORD_CHUNK_SIZE)
        }
      });
    }
  }

  return chunks.length > 0 ? chunks : [base];
}

export class HealthConnectApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly deviceToken: string | null = null
  ) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
  }

  async registerDevice(pairingCode: string, deviceName: string) {
    return this.request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ pairing_code: pairingCode, device_name: deviceName })
    });
  }

  async checkReady(): Promise<{ status: string; app: string }> {
    return this.request('/health/ready', {}, { auth: false });
  }

  async ingestHealthBatch(batch: HealthBatchRequest) {
    const body = JSON.stringify(batch);
    healthApiLog('info', `[ALIS Health API] Envoi ingest santé: ${body.length} octets`);
    const requestOptions = {
      timeoutMs: HEALTH_INGEST_TIMEOUT_MS,
      timeoutMessage: 'La synchronisation santé prend trop de temps. Vérifie la connexion puis réessaie.'
    };
    if (body.length > MAX_HEALTH_INGEST_BODY_BYTES) {
      return this.ingestHealthBatchInChunks(batch, requestOptions);
    }
    try {
      return await this.request('/api/v1/ingest/health', {
        method: 'POST',
        body
      }, requestOptions);
    } catch (error) {
      if (!isRetriableIngestError(error) || !batch.raw_records) {
        throw error;
      }

      const compactBatch = compactBatchForNetworkRetry(batch);
      const compactBody = JSON.stringify(compactBatch);
      healthApiLog(
        'warn',
        `[ALIS Health API] Retry ingest compact apres echec reseau: ${body.length} -> ${compactBody.length} octets`
      );
      if (compactBody.length > MAX_HEALTH_INGEST_BODY_BYTES) {
        return this.ingestHealthBatchInChunks(compactBatch, requestOptions);
      }
      return this.request('/api/v1/ingest/health', {
        method: 'POST',
        body: compactBody
      }, requestOptions);
    }
  }

  private async ingestHealthBatchInChunks(
    batch: HealthBatchRequest,
    requestOptions: { timeoutMs: number; timeoutMessage: string }
  ) {
    const chunks = splitHealthBatch(batch);
    healthApiLog('warn', `[ALIS Health API] Ingest santé découpé en ${chunks.length} lot(s)`);
    let recordsReceived = 0;
    let lastResponse: any = null;

    for (let index = 0; index < chunks.length; index += 1) {
      const chunkBody = JSON.stringify(chunks[index]);
      healthApiLog('info', `[ALIS Health API] Envoi lot santé ${index + 1}/${chunks.length}: ${chunkBody.length} octets`);
      lastResponse = await this.request('/api/v1/ingest/health', {
        method: 'POST',
        body: chunkBody
      }, requestOptions);
      if (typeof lastResponse?.records_received === 'number') {
        recordsReceived += lastResponse.records_received;
      }
    }

    return {
      ...(lastResponse ?? {}),
      records_received: recordsReceived || lastResponse?.records_received || 0,
      message: chunks.length > 1 ? `Synchronisation envoyée en ${chunks.length} lots.` : lastResponse?.message
    };
  }

  async getLatestSyncRun() {
    return this.request('/api/v1/sync-runs/latest');
  }

  async recompute(windows: Array<'24h' | '7d' | '30d'> = ['24h', '7d', '30d']) {
    return this.request('/api/v1/processing/recompute', {
      method: 'POST',
      body: JSON.stringify({ windows })
    });
  }

  async getOverview(window: '24h' | '7d' | '30d' = '7d') {
    return this.request(`/api/v1/context/overview?window=${window}`);
  }

  private async request(
    path: string,
    init: RequestInit = {},
    options: { auth?: boolean; timeoutMs?: number; timeoutMessage?: string } = {}
  ) {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (options.auth !== false && this.deviceToken) {
      headers.set('Authorization', `Bearer ${this.deviceToken}`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(options.timeoutMessage ?? `Impossible de joindre ${this.baseUrl} après 8s`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`HealthConnect API ${response.status}: ${detail}`);
    }
    return response.json();
  }
}
