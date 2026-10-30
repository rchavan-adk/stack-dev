const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: Date | null | undefined, fallback = "never"): string {
  return value ? DATE.format(value) : fallback;
}

export function formatDateTime(value: Date | null | undefined, fallback = "—"): string {
  return value ? DATE_TIME.format(value) : fallback;
}

/**
 * Money, for people to read.
 *
 * Cents are too coarse for a single model call: a cheap one costs a few
 * thousandths of a cent, and showing it as $0.00 makes a working meter look
 * broken. A cent or more reads normally; below that we show enough digits to
 * prove the call was counted.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0.00";
  if (value >= 0.01) return value.toFixed(2);
  if (value < 0.0001) return "<0.0001";
  return value.toFixed(4);
}
