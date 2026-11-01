const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

interface RelativeAgeUnit {
  duration: number;
  divisor: number;
  name: string;
}

const AGE_UNITS: RelativeAgeUnit[] = [
  { duration: 60 * MINUTE_MS, divisor: MINUTE_MS, name: 'minute' },
  { duration: 24 * HOUR_MS, divisor: HOUR_MS, name: 'hour' },
  { duration: 30 * DAY_MS, divisor: DAY_MS, name: 'day' },
];

export function formatCommitAge(
  value: string | null,
  now = Date.now()
): string {
  if (!value) return 'Date unknown';
  const elapsed = Math.max(0, now - new Date(value).getTime());
  if (elapsed < MINUTE_MS) return 'just now';

  const unit = AGE_UNITS.find(({ duration }) => elapsed < duration);
  if (unit) return formatAmount(Math.floor(elapsed / unit.divisor), unit.name);

  const days = Math.floor(elapsed / DAY_MS);
  if (days < 360) return formatAmount(Math.floor(days / 30), 'month');
  return formatAmount(Math.floor(days / 365), 'year');
}

function formatAmount(amount: number, unit: string): string {
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
}
