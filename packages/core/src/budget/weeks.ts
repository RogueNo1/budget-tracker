/** Monday of the ISO week containing dateIso (YYYY-MM-DD), returned as YYYY-MM-DD. */
export function mondayOfWeek(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  const day = d.getDay(); // 0=Sun .. 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
