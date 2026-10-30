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
