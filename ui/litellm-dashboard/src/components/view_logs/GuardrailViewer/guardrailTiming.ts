export interface TimingInterval {
  start_time: number;
  end_time: number;
}

export const formatDurationMs = (seconds: number): string => {
  const ms = Math.round(seconds * 1000);
  return seconds > 0 && ms === 0 ? "<1ms" : `${ms}ms`;
};

export const isValidInterval = (interval?: TimingInterval): interval is TimingInterval => {
  if (!interval) return false;
  const finiteBounds = Number.isFinite(interval.start_time) && Number.isFinite(interval.end_time);
  return finiteBounds && interval.end_time >= interval.start_time;
};

export const getMeasuredOverhead = (
  entries: (TimingInterval & { shared_analysis?: TimingInterval })[],
): number | null => {
  const intervals = entries
    .flatMap((entry) => [entry, entry.shared_analysis])
    .filter(isValidInterval)
    .sort((left, right) => left.start_time - right.start_time);
  if (intervals.length === 0) return null;
  const result = intervals.reduce(
    (state, interval) => ({
      end: Math.max(state.end, interval.end_time),
      seconds: state.seconds + Math.max(0, interval.end_time - Math.max(state.end, interval.start_time)),
    }),
    { end: -Infinity, seconds: 0 },
  );
  return result.seconds;
};
