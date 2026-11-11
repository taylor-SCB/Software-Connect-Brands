// Day and time chips for the contact page's sheets (Book meeting, Move,
// Set follow-up): Tomorrow · Thu · Next week · Pick, and 9 · 10 · 11 · 1 ·
// 2 · 3 · Pick. Days are the workspace's yyyy-mm-dd, worked from the
// server's "today" so the browser's clock never decides the day.

const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

export function shiftDay(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dow(iso: string) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function dayChips(today: string): { label: string; on: string }[] {
  const tomorrow = shiftDay(today, 1);
  // The working day after tomorrow, named.
  let second = shiftDay(today, 2);
  while (dow(second) === 0 || dow(second) === 6) second = shiftDay(second, 1);
  // Next Monday, at least three days out.
  let monday = shiftDay(today, 1);
  while (dow(monday) !== 1 || monday <= shiftDay(today, 2)) monday = shiftDay(monday, 1);
  const chips = [
    { label: "Tomorrow", on: tomorrow },
    { label: weekday.format(new Date(`${second}T12:00:00Z`)), on: second },
    { label: "Next week", on: monday },
  ];
  // Never two chips for the same day.
  return chips.filter((chip, index) => chips.findIndex((other) => other.on === chip.on) === index);
}

export const TIME_CHIPS = [
  { label: "9", value: "09:00" },
  { label: "10", value: "10:00" },
  { label: "11", value: "11:00" },
  { label: "1", value: "13:00" },
  { label: "2", value: "14:00" },
  { label: "3", value: "15:00" },
];

const longDay = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// "Tue, Nov 17".
export function dayWords(iso: string) {
  return longDay.format(new Date(`${iso}T12:00:00Z`));
}
