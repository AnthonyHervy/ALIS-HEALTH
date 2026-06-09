import { getSyncDecision } from '../sync/sync-policy';

test('requires manual initial sync before background sync', () => {
  expect(
    getSyncDecision({
      now: '2026-05-19T12:00:00.000Z',
      apiBaseUrl: 'http://localhost:8010',
      deviceToken: 'token',
      lastSyncAt: null
    })
  ).toMatchObject({ shouldSync: false, reason: 'initial_sync_required' });
});

test('triggers sync after the hourly freshness window', () => {
  expect(
    getSyncDecision({
      now: '2026-05-19T12:00:00.000Z',
      apiBaseUrl: 'http://localhost:8010',
      deviceToken: 'token',
      lastSyncAt: '2026-05-19T10:30:00.000Z'
    })
  ).toMatchObject({ shouldSync: true, reason: 'sync_due' });
});
