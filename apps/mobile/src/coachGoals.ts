import type { CoachGoal } from './types';

type Direction = 'up' | 'down';

export function activeCoachGoals(goals: readonly CoachGoal[]): CoachGoal[] {
  return goals
    .filter((goal) => goal.enabled)
    .sort(byPriority)
    .map((goal, index) => ({ ...goal, priority: index + 1 }));
}

export function inactiveCoachGoals(goals: readonly CoachGoal[]): CoachGoal[] {
  return goals
    .filter((goal) => !goal.enabled)
    .sort(byPriority);
}

export function toggleCoachGoalEnabled(goals: readonly CoachGoal[], slug: string, enabled: boolean): CoachGoal[] {
  const next = goals.map((goal) => (goal.slug === slug ? { ...goal, enabled } : goal));
  return resequence(next);
}

export function moveCoachGoalPriority(goals: readonly CoachGoal[], slug: string, direction: Direction): CoachGoal[] {
  const active = activeCoachGoals(goals);
  const from = active.findIndex((goal) => goal.slug === slug);
  if (from < 0) {
    return resequence(goals);
  }
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= active.length) {
    return resequence(goals);
  }

  const reordered = [...active];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  return resequence([
    ...reordered.map((goal, index) => ({ ...goal, priority: index + 1 })),
    ...inactiveCoachGoals(goals)
  ]);
}

export function resequenceCoachGoals(goals: readonly CoachGoal[]): CoachGoal[] {
  return resequence(goals);
}

function resequence(goals: readonly CoachGoal[]): CoachGoal[] {
  const active = goals
    .filter((goal) => goal.enabled)
    .sort(byPriority)
    .map((goal, index) => ({ ...goal, priority: index + 1 }));
  const inactive = goals
    .filter((goal) => !goal.enabled)
    .sort(byPriority)
    .map((goal, index) => ({ ...goal, priority: active.length + index + 1 }));
  return [...active, ...inactive];
}

function byPriority(left: CoachGoal, right: CoachGoal) {
  return (left.priority || 99) - (right.priority || 99);
}
