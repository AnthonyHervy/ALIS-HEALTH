import { DEFAULT_DASHBOARD_ORDER, mergeVisibleDashboardOrder, moveDashboardBlock, moveDashboardBlockTo, normalizeDashboardOrder, visibleDashboardBlocksForWindow } from './dashboardLayout';

test('normalizes the saved dashboard order without losing new home blocks', () => {
  expect(normalizeDashboardOrder(['coach', 'scores', 'unknown', 'coach'] as string[])).toEqual([
    'coach',
    'scores',
    ...DEFAULT_DASHBOARD_ORDER.filter((key) => !['coach', 'scores'].includes(key))
  ]);
});

test('moves a dashboard block while keeping the metrics summary as one unit', () => {
  const order = normalizeDashboardOrder(['scores', 'today', 'summary', 'sync']);

  expect(moveDashboardBlock(order, 'summary', -1)).toEqual([
    'scores',
    'summary',
    'today',
    'sync',
    ...DEFAULT_DASHBOARD_ORDER.filter((key) => !['scores', 'today', 'summary', 'sync'].includes(key))
  ]);
  expect(moveDashboardBlock(order, 'scores', -1)[0]).toBe('scores');
});

test('moves a dashboard block directly to a target position after a long drag', () => {
  const order = normalizeDashboardOrder(['scores', 'morning', 'sync', 'coach']);

  expect(moveDashboardBlockTo(order, 'scores', 3).slice(0, 4)).toEqual([
    'morning',
    'sync',
    'coach',
    'scores'
  ]);
  expect(moveDashboardBlockTo(order, 'coach', -4)[0]).toBe('coach');
});

test('puts the daily AI action immediately below scores in the default today layout', () => {
  expect(DEFAULT_DASHBOARD_ORDER.slice(0, 4)).toEqual(['scores', 'coach', 'sync', 'today']);
});

test('keeps today focused on unique cards without a separate morning or summary duplicate', () => {
  expect(visibleDashboardBlocksForWindow(DEFAULT_DASHBOARD_ORDER, '24h')).toEqual([
    'scores',
    'coach',
    'sync',
    'today',
    'charts',
    'sleepDetails',
    'workoutDetails',
    'workoutHistory'
  ]);
});

test('keeps sync controls on today only', () => {
  expect(visibleDashboardBlocksForWindow(DEFAULT_DASHBOARD_ORDER, '7d')).toEqual([
    'summary',
    'charts',
    'sleepDetails',
    'workoutDetails',
    'workoutHistory'
  ]);
  expect(visibleDashboardBlocksForWindow(DEFAULT_DASHBOARD_ORDER, '30d')).toEqual([
    'summary',
    'charts',
    'sleepDetails',
    'workoutDetails',
    'workoutHistory'
  ]);
});

test('merges a sortable visible order without dropping hidden dashboard blocks', () => {
  const order = normalizeDashboardOrder(['scores', 'coach', 'sync', 'today', 'summary', 'charts']);

  expect(mergeVisibleDashboardOrder(order, '24h', ['today', 'scores', 'coach', 'sync', 'charts']).slice(0, 6)).toEqual([
    'today',
    'scores',
    'coach',
    'sync',
    'summary',
    'charts'
  ]);
});
