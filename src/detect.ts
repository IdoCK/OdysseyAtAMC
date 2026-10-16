import type { FetchResult, MonitorState, Screening, TransitionResult } from "./domain.js";
import { easternIsoDate } from "./eastern-date.js";

export function createEmptyState(): MonitorState {
  return {
    version: 1,
    initialized: false,
    screenings: {},
    lastSuccessfulCheck: null,
    consecutiveFailures: 0,
    warnedForFailureEpisode: false,
    lastNewScreeningDate: null,
    lastDailyStatusDate: null,
  };
}

export function transition(state: MonitorState, fetchResult: FetchResult): TransitionResult {
  if (!fetchResult.ok) {
    return transitionFailure(state, fetchResult.error);
  }

  const screenings = pruneExpiredScreenings(
    mergeScreenings(state.screenings, fetchResult.screenings),
    fetchResult.checkedAt,
  );
  const nextState: MonitorState = {
    ...state,
    initialized: true,
    screenings,
    lastSuccessfulCheck: fetchResult.checkedAt,
    consecutiveFailures: 0,
    warnedForFailureEpisode: false,
  };

  if (!state.initialized) {
    return { kind: "baseline", state: nextState };
  }

  const newBookableScreenings = fetchResult.screenings
    .filter((screening) => isNewlyBookable(state.screenings[screening.id], screening))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));

  if (newBookableScreenings.length > 0) {
    return {
      kind: "notify",
      state: { ...nextState, lastNewScreeningDate: easternIsoDate(fetchResult.checkedAt) },
      screenings: newBookableScreenings,
    };
  }

  return {
    kind: state.consecutiveFailures > 0 ? "recovered" : "silent",
    state: nextState,
  };
}

function transitionFailure(state: MonitorState, error: string): TransitionResult {
  const consecutiveFailures = state.consecutiveFailures + 1;
  const shouldWarn = consecutiveFailures >= 3 && !state.warnedForFailureEpisode;
  const nextState: MonitorState = {
    ...state,
    consecutiveFailures,
    warnedForFailureEpisode: state.warnedForFailureEpisode || shouldWarn,
  };

  return shouldWarn
    ? { kind: "failure-warning", state: nextState, error }
    : { kind: "failure-silent", state: nextState, error };
}

function mergeScreenings(
  knownScreenings: Record<string, Screening>,
  observedScreenings: Screening[],
): Record<string, Screening> {
  return {
    ...knownScreenings,
    ...Object.fromEntries(observedScreenings.map((screening) => [screening.id, screening])),
  };
}

function pruneExpiredScreenings(
  screenings: Record<string, Screening>,
  checkedAt: string,
): Record<string, Screening> {
  const checkedAtValue = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtValue)) return screenings;
  return Object.fromEntries(
    Object.entries(screenings).filter(([, screening]) => {
      const startsAtValue = Date.parse(screening.startsAt);
      return !Number.isFinite(startsAtValue) || startsAtValue > checkedAtValue;
    }),
  );
}

function isNewlyBookable(knownScreening: Screening | undefined, observedScreening: Screening): boolean {
  return (
    observedScreening.availability === "bookable" &&
    (knownScreening === undefined || knownScreening.availability === "unavailable")
  );
}
