import { activeCoachGoals, inactiveCoachGoals, moveCoachGoalPriority, toggleCoachGoalEnabled } from './coachGoals';
import type { CoachGoal } from './types';

const goals: CoachGoal[] = [
  { slug: 'sleep', label: 'Sommeil', priority: 2, enabled: true },
  { slug: 'recovery', label: 'Récupération', priority: 1, enabled: true },
  { slug: 'nutrition', label: 'Nutrition', priority: 3, enabled: false }
];

test('shows enabled coach goals as a top-down priority list', () => {
  expect(activeCoachGoals(goals).map((goal) => goal.label)).toEqual(['Récupération', 'Sommeil']);
  expect(inactiveCoachGoals(goals).map((goal) => goal.label)).toEqual(['Nutrition']);
});

test('disabling a coach goal removes it from the active priorities and resequences the rest', () => {
  const next = toggleCoachGoalEnabled(goals, 'recovery', false);

  expect(activeCoachGoals(next)).toEqual([
    { slug: 'sleep', label: 'Sommeil', priority: 1, enabled: true }
  ]);
  expect(inactiveCoachGoals(next).map((goal) => goal.slug)).toContain('recovery');
});

test('moving a coach goal changes the saved priority order', () => {
  const next = moveCoachGoalPriority(goals, 'sleep', 'up');

  expect(activeCoachGoals(next).map((goal) => `${goal.priority}.${goal.slug}`)).toEqual(['1.sleep', '2.recovery']);
});
