import { workManagerContract } from '../native/workmanager-contract';

test('uses an hourly background sync contract without a wifi-only gate', () => {
  expect(workManagerContract).toEqual({
    uniqueName: 'healthconnect-background-sync',
    repeatIntervalHours: 1,
    requiredNetworkType: 'ANY_CONNECTED_NETWORK',
    sleepLookbackHours: 48
  });
});
