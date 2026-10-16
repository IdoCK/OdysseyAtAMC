const timezone = "America/New_York";

export function easternIsoDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function displayDate(isoDate: string): string {
  const [year = "", month = "", day = ""] = isoDate.split("-");
  return `${day}/${month}/${year.slice(-2)}`;
}
