import { NotFoundException } from '@nestjs/common';
import { PublicPrizeCatalogueService } from './public-prize-catalogue.service';

describe('PublicPrizeCatalogueService', () => {
  const id = 'a'.repeat(24);
  function build(seasons: unknown[], prizes: unknown[], image?: unknown) {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM owner_seasons s')) return Promise.resolve(seasons);
      if (sql.includes('FROM owner_season_prizes\n')) return Promise.resolve(prizes);
      if (sql.includes('FROM owner_season_prizes p')) return Promise.resolve(image ? [{ seasonId: 'active-season' }] : []);
      throw new Error('Unexpected query');
    });
    const db = { transaction: jest.fn(async (f: (conn: { query: typeof query }) => Promise<unknown>) => f({ query })) };
    const media = { open: jest.fn().mockResolvedValue(image) };
    return { service: new PublicPrizeCatalogueService(db as never, media as never), query, media };
  }

  it('returns no catalogue for draft or paused seasons', async () => {
    const { service, query } = build([], []);
    expect(await service.catalogue()).toEqual({ season: null, prizes: [] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("s.status='ACTIVE'");
  });

  it('projects all active prizes in order without leaking admin-only fields', async () => {
    const rows = [
      { monthNumber: 1, prizeCode: 'MONTH_1_PRIZE_1', name: 'EV Scooter', category: 'Prize', description: 'Electric', winnerCount: '1', nominalValue: null, currencyCode: 'INR', mediaId: id, mediaMimeType: 'image/webp', secret: 'should-never-leak' },
      { monthNumber: 1, prizeCode: 'MONTH_1_PRIZE_2', name: 'Gold Coin', category: 'Prize', description: null, winnerCount: 2, nominalValue: '20000.00', currencyCode: 'INR', mediaId: 'b'.repeat(24), mediaMimeType: 'application/pdf' },
      { monthNumber: 9, prizeCode: 'MONTH_9_PRIZE_1', name: 'Outside', category: 'Prize', description: null, winnerCount: 1, nominalValue: null, currencyCode: 'INR', mediaId: null, mediaMimeType: null },
    ];
    const { service, query } = build([{ id: 'active-season', name: 'Active', totalMonths: 2 }], rows);
    const data = await service.catalogue();
    expect(data.season).toEqual({ name: 'Active', totalMonths: 2 });
    expect(data.prizes).toHaveLength(2);
    expect(data.prizes[0]).toMatchObject({ name: 'EV Scooter', imageMediaId: id, winnerCount: 1 });
    expect(data.prizes[1]).toMatchObject({ name: 'Gold Coin', imageMediaId: null, nominalValue: '20000.00' });
    expect(JSON.stringify(data)).not.toContain('should-never-leak');
    expect(query.mock.calls[1][0]).toContain("status='ACTIVE'");
    expect(query.mock.calls[1][1]).toEqual(['active-season']);
  });

  it('rejects guessed, unrelated, cross-season and non-image media', async () => {
    const absent = build([], []);
    await expect(absent.service.openImage('bad')).rejects.toBeInstanceOf(NotFoundException);
    await expect(absent.service.openImage(id)).rejects.toBeInstanceOf(NotFoundException);
    expect(absent.media.open).not.toHaveBeenCalled();
    const cross = build([], [], { info: { seasonId: 'private', contentType: 'image/webp' } });
    await expect(cross.service.openImage(id)).rejects.toBeInstanceOf(NotFoundException);
    const pdf = build([], [], { info: { seasonId: 'active-season', contentType: 'application/pdf' } });
    await expect(pdf.service.openImage(id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns linked image from the current active season', async () => {
    const image = { info: { seasonId: 'active-season', contentType: 'image/png', length: 100 }, stream: {} };
    const { service, query, media } = build([], [], image);
    await expect(service.openImage(id)).resolves.toBe(image);
    expect(media.open).toHaveBeenCalledWith(id);
    expect(query.mock.calls[0][0]).toContain("p.status='ACTIVE'");
    expect(query.mock.calls[0][0]).toContain("s.status='ACTIVE'");
  });
});
