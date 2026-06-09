export const DASHBOARD_BLOCK_KEYS = [
  'scores',
  'morning',
  'sync',
  'coach',
  'today',
  'summary',
  'charts',
  'sleepDetails',
  'workoutDetails',
  'workoutHistory'
] as const;

export type DashboardBlockKey = typeof DASHBOARD_BLOCK_KEYS[number];

export const DEFAULT_DASHBOARD_ORDER: DashboardBlockKey[] = [
  'scores',
  'coach',
  'sync',
  'today',
  'summary',
  'charts',
  'sleepDetails',
  'workoutDetails',
  'workoutHistory'
];

const DASHBOARD_BLOCKS = new Set<string>(DASHBOARD_BLOCK_KEYS);

export function normalizeDashboardOrder(value?: readonly string[] | null): DashboardBlockKey[] {
  const seen = new Set<string>();
  const saved = (value ?? [])
    .filter((key): key is DashboardBlockKey => DASHBOARD_BLOCKS.has(key))
    .filter((key) => {
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  return [
    ...saved,
    ...DEFAULT_DASHBOARD_ORDER.filter((key) => !seen.has(key))
  ];
}

export function moveDashboardBlock(order: readonly DashboardBlockKey[], key: DashboardBlockKey, delta: -1 | 1): DashboardBlockKey[] {
  const normalized = normalizeDashboardOrder(order);
  const index = normalized.indexOf(key);
  const nextIndex = Math.max(0, Math.min(normalized.length - 1, index + delta));
  return moveNormalizedBlock(normalized, index, nextIndex);
}

export function moveDashboardBlockTo(order: readonly DashboardBlockKey[], key: DashboardBlockKey, targetIndex: number): DashboardBlockKey[] {
  const normalized = normalizeDashboardOrder(order);
  const index = normalized.indexOf(key);
  const nextIndex = Math.max(0, Math.min(normalized.length - 1, Math.round(targetIndex)));
  return moveNormalizedBlock(normalized, index, nextIndex);
}

function moveNormalizedBlock(normalized: DashboardBlockKey[], index: number, nextIndex: number): DashboardBlockKey[] {
  if (index < 0 || index === nextIndex) {
    return normalized;
  }
  const next = [...normalized];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function visibleDashboardBlocksForWindow(order: readonly DashboardBlockKey[], window: '24h' | '7d' | '30d'): DashboardBlockKey[] {
  const normalized = normalizeDashboardOrder(order);
  if (window === '24h') {
    return normalized.filter((key) => key !== 'morning' && key !== 'summary');
  }
  return normalized.filter((key) => key !== 'scores' && key !== 'morning' && key !== 'sync' && key !== 'coach' && key !== 'today');
}

export function mergeVisibleDashboardOrder(
  order: readonly DashboardBlockKey[],
  window: '24h' | '7d' | '30d',
  visibleOrder: readonly DashboardBlockKey[]
): DashboardBlockKey[] {
  const normalized = normalizeDashboardOrder(order);
  const currentVisible = visibleDashboardBlocksForWindow(normalized, window);
  const visibleSet = new Set(currentVisible);
  const seen = new Set<DashboardBlockKey>();
  const nextVisible = [
    ...visibleOrder.filter((key) => {
      if (!visibleSet.has(key) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
    ...currentVisible.filter((key) => !seen.has(key))
  ];
  let cursor = 0;
  return normalizeDashboardOrder(normalized.map((key) => (visibleSet.has(key) ? nextVisible[cursor++] : key)));
}
