import { OwnerPortalService } from './owner-portal.service';

describe('Owner dashboard E-PIN face value', () => {
  it('exposes per-currency face values from saved PIN snapshots without affecting cash collection totals', async () => {
    const rows = jest.fn(async (sql: string) => {
      if (sql.includes('FROM owner_epins') && sql.includes('GROUP BY')) {
        expect(sql).toContain("status='ACTIVE' AND expiresAt>?");
        expect(sql).toContain("status='USED'");
        expect(sql).toContain('registrationFeeSnapshot');
        expect(sql).toContain('installmentAmountSnapshot');
        expect(sql).not.toContain('program_payment_records');
        return [
          { currencyCode: 'INR', activeFaceValue: '8000.00', unusedFaceValue: '8000.00',
            usedFaceValue: '2000.00', incompleteSnapshotCount: 0 },
          { currencyCode: 'USD', activeFaceValue: '50.00', unusedFaceValue: '50.00',
            usedFaceValue: '0.00', incompleteSnapshotCount: 1 },
        ];
      }
      if (sql.includes('FROM program_payment_records') && sql.includes('grossCollections')) {
        return [{ paymentCount: 0, grossCollections: '0.00', refundCount: 0, totalRefunds: '0.00' }];
      }
      return [];
    });
    // dashboard() reads snapshot query results; no DB writes, payment posting, or migrations.
    const service = Object.assign(Object.create(OwnerPortalService.prototype), { rows }) as OwnerPortalService;
    const result = await service.dashboard();

    expect(result.grossCollections).toBe(0);
    expect(result.netCollections).toBe(0);
    expect(result.epinFaceValues).toEqual([
      { currencyCode: 'INR', activeFaceValue: '8000.00', unusedFaceValue: '8000.00',
        usedFaceValue: '2000.00', incompleteSnapshotCount: 0 },
      { currencyCode: 'USD', activeFaceValue: '50.00', unusedFaceValue: '50.00',
        usedFaceValue: '0.00', incompleteSnapshotCount: 1 },
    ]);
    expect(rows.mock.calls.some(([sql]) => sql.includes('FROM owner_epins') && sql.includes('GROUP BY'))).toBe(true);
  });
});
