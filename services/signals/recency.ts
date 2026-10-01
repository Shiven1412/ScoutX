const DEFAULT_RECENCY_MONTHS = 6;

export function isRecentSignal(date: string | number | Date, months = DEFAULT_RECENCY_MONTHS) {
  const timestamp = date instanceof Date
    ? date.getTime()
    : typeof date === "number"
      ? date < 1_000_000_000_000 ? date * 1000 : date
      : Date.parse(date);
  if (!Number.isFinite(timestamp) || !Number.isFinite(months) || months < 0) return false;

  const cutoff = new Date();
  const dayOfMonth = cutoff.getDate();
  cutoff.setDate(1);
  cutoff.setMonth(cutoff.getMonth() - months);
  const lastDayInCutoffMonth = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
  cutoff.setDate(Math.min(dayOfMonth, lastDayInCutoffMonth));
  return timestamp >= cutoff.getTime();
}
