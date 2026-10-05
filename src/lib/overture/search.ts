export type OvertureSearchRecord = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number;
  lon: number;
  primary: string | null;
};

export type OvertureSearchOptions = {
  limit?: number;
};

export function normalizeOvertureSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

type ScoredRecord = {
  record: OvertureSearchRecord;
  score: number;
  name: string;
  city: string;
};

function countMatchingTokens(tokens: string[], value: string): number {
  return tokens.reduce((count, token) => count + (value.includes(token) ? 1 : 0), 0);
}

function compareNormalizedText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function searchOverturePlaces(
  records: readonly OvertureSearchRecord[],
  query: string,
  options: OvertureSearchOptions = {},
): OvertureSearchRecord[] {
  const normalizedQuery = normalizeOvertureSearchText(query);
  if (!normalizedQuery) return [];

  const tokens = normalizedQuery.split(" ");
  const limit = Math.max(0, Math.floor(options.limit ?? 20));
  if (limit === 0) return [];

  const scored: ScoredRecord[] = [];

  for (const record of records) {
    const name = normalizeOvertureSearchText(record.name);
    const city = normalizeOvertureSearchText(record.city);
    const address = normalizeOvertureSearchText(record.address ?? "");
    const searchableText = `${name} ${city} ${address}`;

    if (tokens.some((token) => !searchableText.includes(token))) continue;

    let score = 0;
    if (name === normalizedQuery) score += 1000;
    else if (name.startsWith(normalizedQuery)) score += 900;
    else if (name.includes(normalizedQuery)) score += 800;

    const nameTokenMatches = countMatchingTokens(tokens, name);
    score += nameTokenMatches * 100;

    if (city === normalizedQuery) score += 70;
    else if (city.startsWith(normalizedQuery)) score += 60;
    else if (city.includes(normalizedQuery)) score += 50;
    score += countMatchingTokens(tokens, city) * 10;

    score += countMatchingTokens(tokens, address) * 1;

    scored.push({ record, score, name, city });
  }

  scored.sort((left, right) =>
    right.score - left.score
    || compareNormalizedText(left.name, right.name)
    || compareNormalizedText(left.city, right.city)
    || compareNormalizedText(left.record.id, right.record.id),
  );

  return scored.slice(0, limit).map(({ record }) => record);
}
