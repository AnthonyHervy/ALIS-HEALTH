# Data Reliability Center + Coach IA v2 Design

## Summary

ALIS will add a user-facing Data Reliability Center and feed the same compact reliability context into the AI coach. The goal is to make data discrepancies understandable without turning the main dashboard into a debug screen.

The selected approach is hybrid:

- Keep the `Today` dashboard simple and premium.
- Add discreet reliability badges on sensitive cards when useful.
- Provide a dedicated `Sources & reliability` detail view from dashboard cards and Settings.
- Keep source preferences in advanced Settings.
- Give the coach a compact reliability summary so it can explain or qualify advice when data is partial, corrected, conflicting, or stale.

## Goals

- Explain why ALIS shows a value when Garmin, Whoop/Noop, Ultrahuman, Google Fit, Android, or Health Connect appear to differ.
- Make source decisions readable by a non-developer.
- Prevent missing data from being interpreted as a real zero.
- Preserve the current cockpit design: scores and cards remain the primary experience.
- Improve coach answers by including data confidence only when it matters.
- Cover French and English UI copy from the beginning.

## Non-Goals

- No direct Garmin or Whoop cloud integration in this V1.
- No medical diagnosis or medical-device style interpretation.
- No advanced per-source weighting UI beyond the existing source preference model.
- No full historical conflict explorer in V1.
- No rewrite of the existing ingestion, dashboard, or coach architecture.

## Product UX

### Today Dashboard

Cards such as steps, sport, sleep, calories, heart rate, HRV, and VO2 max will show one compact reliability badge when the metric is not plainly high-confidence:

- `Reliable` / `Fiable`
- `Partial` / `Partiel`
- `Corrected` / `Corrige`
- `Check` / `A verifier`

Badges appear only when they help the user understand the value. A fully reliable card remains visually quiet unless the user opens details.

Tapping a card badge, or the card itself when the card has a reliability summary, opens the `Sources & reliability` detail view focused on that metric.

### Sources & Reliability View

The detail view explains the selected metric in human language:

- retained value;
- retained source;
- freshness;
- confidence;
- other received sources and their values;
- reason for the source choice;
- whether ALIS corrected or fell back from the preferred source.

Example copy:

- "ALIS keeps Garmin for steps today."
- "The preferred source looked partial, so ALIS used the most complete plausible Garmin value."
- "Whoop/Noop sent recent sleep data. Google Fit is present but less complete for this metric."

The view should avoid raw debug wording such as `records`, `payload`, `batch`, or package IDs unless the user expands an advanced section.

### Settings

Settings keeps a `Sources & reliability` entry inside the advanced block. It shows the full list of metric summaries and source preferences by domain.

Advanced details can still show package IDs and raw diagnostic counts for troubleshooting, but the default presentation is product copy.

## Data Model

The API will expose a compact reliability summary derived from the existing source config and source diagnostics.

Proposed shape:

```ts
type ReliabilityConfidence = "high" | "medium" | "low";

type ReliabilityStatus =
  | "measured"
  | "partial"
  | "corrected"
  | "missing"
  | "conflict";

type MetricReliabilitySummary = {
  metric:
    | "steps"
    | "sleep"
    | "workouts"
    | "active_calories"
    | "heart_rate"
    | "hrv"
    | "vo2_max";
  domain: "activity" | "sleep" | "workouts" | "biometrics";
  status: ReliabilityStatus;
  confidence: ReliabilityConfidence;
  selected_source: string | null;
  selected_source_label: string;
  selected_value: number | null;
  unit: string | null;
  latest_received_at: string | null;
  badge_label: string;
  user_explanation: string;
  coach_reason: string;
  sources: Array<{
    source: string;
    source_label: string;
    value: number | null;
    unit: string | null;
    latest_received_at: string | null;
    selected: boolean;
    note: string | null;
  }>;
};

type DataReliabilitySummary = {
  generated_at: string;
  metrics: Record<string, MetricReliabilitySummary>;
};
```

This can live next to the current `source_diagnostics` in the dashboard response as `data_reliability`.

## Source Selection Rules

ALIS will keep deterministic rules so the same inputs always produce the same retained value.

1. Use the preferred source for the domain when it has a plausible recent value.
2. If the preferred source is missing, stale, or clearly partial, fall back to the best plausible source.
3. Mark the metric as `corrected` when ALIS uses a fallback value instead of the preferred source.
4. Mark the metric as `partial` when there is data, but it is too incomplete to fully trust.
5. Mark the metric as `conflict` when two plausible sources disagree enough that ALIS should surface uncertainty.
6. Mark the metric as `missing` only when no usable source exists.
7. Never describe missing nutrition, hydration, HRV, VO2 max, or sport as proof that the user did not eat, drink, recover, or train.

V1 thresholds:

- A selected steps source is considered clearly partial when another plausible source has at least `1.5x` the selected value for the same day.
- A metric is `corrected` when ALIS uses that fallback value for the displayed value.
- A metric is `conflict` when ALIS keeps the preferred value but another plausible source differs by at least `50%`.
- A source is stale for a daily metric when its latest received timestamp is not from the displayed local day.
- For HRV and VO2 max, missing data in a 7-day window remains `missing` or `partial`, but the 30-day view can still show older available values.

For steps, the current fallback-to-best-source behavior remains valid and becomes explicitly visible to the user. The summary explains when steps were recovered from a better source because the retained source lagged.

## Coach IA v2

The coach receives the compact `data_reliability` context through `coach_summary`, not raw source diagnostics.

The coach should mention reliability only when:

- the user asks about a number;
- reliability changes the recommendation;
- a value is partial, corrected, conflicting, missing, or stale;
- the coach would otherwise risk over-interpreting weak data.

The coach should remain conversational:

- 2 to 4 short mobile-friendly paragraphs by default;
- one short title only when useful;
- mini-list only for concrete actions;
- no tables;
- no debug terms;
- warm, precise, motivating style.

Example:

"I would keep a small reserve on movement today: ALIS recovered steps from Garmin because the first source looked partial. That means the day is probably more active than the initial number suggested, so I would not add intensity just to close a false gap."

## Mobile Architecture

Mobile changes should be small and local:

- Extend `DashboardData` types with `data_reliability`.
- Add a presentation helper, for example `formatReliabilitySummary`.
- Add dashboard badges where useful.
- Add a dedicated reliability detail surface, preferably an in-app panel/modal or a simple internal view, not another bottom tab.
- Reuse the existing i18n helper for FR/EN copy.
- Keep advanced raw diagnostics in Settings.

## API Architecture

API changes should extend the current source reliability services:

- Add a function that converts `SourceDiagnostics` into `DataReliabilitySummary`.
- Reuse existing source display labels and diagnostic aggregation.
- Add tests around preferred-source fallback, corrected status, missing status, and conflict status.
- Include `data_reliability` in `dashboard_bundle`.
- Include a compact subset in `coach_summary`.

This avoids a new persistence layer in V1. The summary is computed from existing raw batches, normalized observations, and source preferences.

## Testing Strategy

API tests:

- preferred source with complete data returns `measured` and `high`;
- preferred source partial but another plausible source is better returns `corrected`;
- no usable source returns `missing` and low confidence;
- two plausible sources far apart return `conflict`;
- `dashboard_bundle` exposes `data_reliability`;
- `coach_summary` receives compact reliability context.

Mobile tests:

- dashboard types parse `data_reliability`;
- badges map statuses to FR/EN labels;
- reliability detail copy hides debug-only terms by default;
- tapping a reliability badge opens the detail view;
- Settings still exposes advanced diagnostics;
- English mode has no French reliability labels.

Coach tests:

- prompt includes reliability context;
- fallback coach mentions corrected or partial data when relevant;
- missing nutrition/hydration is described as unlogged data, not as user behavior;
- responses stay conversational rather than debug-like.

## Acceptance Criteria

- A user can understand why ALIS shows a different step count from Garmin or another source.
- `Today` stays visually clean and does not become a diagnostics dashboard.
- Source details are available within one tap from relevant metrics.
- Coach answers acknowledge data reliability when it matters.
- FR/EN copy is complete for new UI.
- Existing mobile and API tests still pass.
- `scripts/security-check.sh` still passes before merge.
