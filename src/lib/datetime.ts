// Helpers for <input type="datetime-local">, which works in the viewer's
// local time zone and has the format `YYYY-MM-DDTHH:mm`.

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ISO string (or null) -> value for a datetime-local input (local time).
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

// datetime-local input value -> ISO string, or null when empty.
export function datetimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
