import { apiBaseUrl } from '@/lib/server-session';

export type PublishedPrize = {
  monthNumber: number;
  prizeCode: string;
  name: string;
  category: string;
  description: string | null;
  winnerCount: number;
  nominalValue: string | null;
  currencyCode: string;
  imageMediaId: string | null;
};
export type PublishedCatalogue = {
  season: { name: string; totalMonths: number } | null;
  prizes: PublishedPrize[];
};

/** Fail closed when the API is offline or returns malformed data. */
export async function readPublishedPrizes(): Promise<PublishedCatalogue | null> {
  try {
    const response = await fetch(`${apiBaseUrl()}/public/prizes/catalogue`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('season' in data) || !('prizes' in data)) return null;
    const record = data as { season: unknown; prizes: unknown };
    if (!Array.isArray(record.prizes)) return null;
    if (record.season !== null &&
      (!record.season || typeof record.season !== 'object' ||
       !('totalMonths' in record.season) || !('name' in record.season) ||
       typeof record.season.totalMonths !== 'number' ||
       !Number.isInteger(record.season.totalMonths) ||
       record.season.totalMonths < 1 || record.season.totalMonths > 60 ||
       typeof record.season.name !== 'string')) return null;
    const prizes: PublishedPrize[] = [];
    for (const item of record.prizes) {
      if (!item || typeof item !== 'object') return null;
      const p = item as Record<string, unknown>;
      if (!Number.isInteger(p.monthNumber) || typeof p.prizeCode !== 'string' ||
        typeof p.name !== 'string' || typeof p.category !== 'string' ||
        !Number.isInteger(p.winnerCount) || typeof p.currencyCode !== 'string' ||
        !(p.description === null || typeof p.description === 'string') ||
        !(p.nominalValue === null || typeof p.nominalValue === 'string') ||
        !(p.imageMediaId === null ||
          (typeof p.imageMediaId === 'string' && /^[a-f\d]{24}$/i.test(p.imageMediaId)))) return null;
      prizes.push(p as PublishedPrize);
    }
    return { season: record.season as PublishedCatalogue['season'], prizes };
  } catch {
    // Frontend-only smoke and API outages show a clear unavailable state.
    return null;
  }
}
