export function karachiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function reportPeriod(preset = "monthly", now = new Date()) {
  const to = karachiToday(now), d = new Date(to + "T00:00:00Z");
  if (preset === "monthly") d.setUTCDate(1);
  if (preset === "weekly") d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return { from: d.toISOString().slice(0, 10), to };
}
export const periodLabel = p => p.from + " to " + p.to;
export const periodPills = attribute => '<div class="report-period-pills" aria-label="Reporting period">' + [["daily", "Today"], ["weekly", "This week"], ["monthly", "This month"]].map(([key,label]) => '<button type="button" class="button secondary compact' + (key === "monthly" ? ' active' : '') + '" ' + attribute + '="' + key + '" aria-pressed="' + (key === "monthly") + '">' + label + '</button>').join("") + '</div>';
