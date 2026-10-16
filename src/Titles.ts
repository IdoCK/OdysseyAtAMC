// Add or remove movies here. Put alternate names for the same movie in aliases.
// Matching is case-insensitive and allows AMC to append text such as "IMAX Fan Event".
export const TRACKED_MOVIES = [
  { title: "The Odyssey", aliases: [] },
  { title: "Digger", aliases: [] },
  { title: "Dune: Part Three", aliases: ["Dune: Messiah"] },
  { title: "Avengers: Doomsday", aliases: [] },
  { title: "The Legend of Zelda", aliases: [] },
] as const;

export const TRACKED_TITLES: readonly string[] = TRACKED_MOVIES
  .flatMap(({ title, aliases }) => [title, ...aliases]);

export const DAILY_STATUS_TITLES: readonly string[] = TRACKED_MOVIES
  .map(({ title }) => title);

function normalizeTitle(title: string): string {
  const trimmed = title.normalize("NFKC").trim().toLowerCase();
  const sortableTitle = trimmed.match(/^(.+),\s*(the|a|an)$/);
  const ordered = sortableTitle ? `${sortableTitle[2]} ${sortableTitle[1]}` : trimmed;
  return ordered.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function isTrackedTitle(title: string, trackedTitles: readonly string[]): boolean {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return false;

  return trackedTitles.some((trackedTitle) => {
    const normalizedTrackedTitle = normalizeTitle(trackedTitle);
    return normalizedTrackedTitle.length > 0 && normalizedTitle.includes(normalizedTrackedTitle);
  });
}
