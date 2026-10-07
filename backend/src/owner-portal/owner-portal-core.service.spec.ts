import { OwnerPortalCoreService } from './owner-portal-core.service';

describe('OwnerPortalCoreService', () => {
  function serviceFor(policy: Record<string, unknown>) {
    const query = jest.fn().mockResolvedValue([policy]);
    const db = {
      transaction: jest.fn(async (work: (connection: { query: jest.Mock }) => unknown) =>
        work({ query }),
      ),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const portal = {
      createMember: jest.fn().mockResolvedValue({ id: 'member-1', username: 'MGC1001' }),
      memberDetail: jest.fn().mockResolvedValue({ id: 'member-1', username: 'MGC1001' }),
    };
    const genealogy = {
      assignSponsor: jest.fn().mockResolvedValue(undefined),
      autoPlace: jest.fn().mockResolvedValue(undefined),
      assignPlacement: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new OwnerPortalCoreService(db as never, portal as never, genealogy as never),
      db,
      portal,
      genealogy,
    };
  }

  it('generates a one-time password and requires rotation for AUTO owner registration', async () => {
    const { service, db, portal } = serviceFor({
      emailRequired: false,
      mobileRequired: true,
      passwordMode: 'AUTO',
      usernameMode: 'AUTO',
      usernamePrefixEnabled: true,
      usernamePrefix: 'MGC',
      defaultRoleName: 'MEMBER',
    });

    const result = await service.createMember(
      {
        fullName: 'Demo Member',
        phone: '+919999999999',
        memberType: 'CUSTOMER',
        placement: 'AUTO',
      },
      'admin-1',
    );

    expect(portal.createMember).toHaveBeenCalledWith(
      expect.objectContaining({ password: expect.any(String) }),
      'admin-1',
    );
    expect(portal.memberDetail).toHaveBeenCalledWith('member-1');
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('mustChangePassword=TRUE'),
      ['member-1'],
    );
    expect(result.initialPassword).toEqual(expect.any(String));
    expect(result.initialPassword.length).toBeGreaterThanOrEqual(20);
  });

  it('enforces configured required identifiers before member creation', async () => {
    const { service, db, portal } = serviceFor({
      emailRequired: true,
      mobileRequired: true,
      passwordMode: 'MANUAL',
      usernameMode: 'MANUAL',
      usernamePrefixEnabled: false,
      usernamePrefix: null,
      defaultRoleName: 'MEMBER',
    });

    await expect(
      service.createMember(
        {
          username: 'member1',
          fullName: 'Demo Member',
          password: 'StrongPassword123',
          memberType: 'CUSTOMER',
          placement: 'AUTO',
        },
        'admin-1',
      ),
    ).rejects.toThrow('Email is required by the registration policy');
    expect(portal.createMember).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('loads the persisted Binary 1:4 descendants for the preferred top-level root', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'root-1',
          username: 'uatroot',
          firstName: 'UAT',
          lastName: 'Root Sponsor',
          status: 'ACTIVE',
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
          directChildCount: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'member-a',
          username: 'MGC585499',
          firstName: 'Demo',
          lastName: 'User for A',
          status: 'ACTIVE',
          parentUserId: 'root-1',
          parentUsername: 'uatroot',
          slot: 'A',
          side: 'LEFT',
          depth: 1,
          firstLegSlot: 'A',
          firstLegSide: 'LEFT',
        },
        {
          id: 'member-b',
          username: 'MGC709887',
          firstName: 'Demo',
          lastName: 'user B',
          status: 'ACTIVE',
          parentUserId: 'root-1',
          parentUsername: 'uatroot',
          slot: 'B',
          side: 'LEFT',
          depth: 1,
          firstLegSlot: 'B',
          firstLegSide: 'LEFT',
        },
      ]);
    const db = {
      transaction: jest.fn(async (work: (connection: { query: jest.Mock }) => unknown) =>
        work({ query }),
      ),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OwnerPortalCoreService(
      db as never,
      {} as never,
      {} as never,
    );

    const result = await service.binaryGenealogy();

    expect(result.root).toMatchObject({
      id: 'root-1',
      username: 'uatroot',
      directChildCount: 2,
    });
    expect(result.visibleMemberCount).toBe(2);
    expect(result.members).toEqual([
      expect.objectContaining({ username: 'MGC585499', slot: 'A', side: 'LEFT', depth: 1 }),
      expect.objectContaining({ username: 'MGC709887', slot: 'B', side: 'LEFT', depth: 1 }),
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual(['root-1']);
  });

  it('lists both top-level and nested members and keeps sponsor distinct from placement parent', async () => {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM users u') && sql.includes('INNER JOIN user_roles')) {
        return Promise.resolve([
          {
            id: 'root-1', username: 'uatroot', firstName: 'UAT', lastName: 'Root',
            status: 'ACTIVE', createdAt: new Date('2026-10-01T00:00:00.000Z'),
            directChildCount: 4, sponsorUsername: null,
            sponsorUserId: null, placementParentUsername: null, placementParentUserId: null,
          },
          {
            id: 'nested-1', username: 'MGC695322', firstName: 'Ankulat', lastName: '',
            status: 'ACTIVE', createdAt: new Date('2026-10-07T06:00:00.000Z'),
            directChildCount: 0, sponsorUsername: 'uatroot',
            sponsorUserId: 'root-1', placementParentUsername: 'MGC585499',
            placementParentUserId: 'parent-a',
          },
        ]);
      }
      if (sql.includes('SELECT id, username FROM users')) {
        return Promise.resolve([{ id: 'nested-1', username: 'MGC695322' }]);
      }
      if (sql.includes('WHERE u.id=? LIMIT 1')) {
        return Promise.resolve([{
          id: 'nested-1', username: 'MGC695322', firstName: 'Ankulat', lastName: '',
          status: 'ACTIVE', directChildCount: 0,
          sponsorUsername: 'uatroot', sponsorUserId: 'root-1',
          placementParentUsername: 'MGC585499', placementParentUserId: 'parent-a',
        }]);
      }
      if (sql.includes('FROM binary_ancestry ba')) return Promise.resolve([]);
      throw new Error('Unexpected binary genealogy query');
    });
    const db = {
      transaction: jest.fn(async (work: (connection: { query: jest.Mock }) => unknown) =>
        work({ query }),
      ),
    };
    const service = new OwnerPortalCoreService(db as never, {} as never, {} as never);
    const result = await service.binaryGenealogy('MGC695322');

    expect(result.roots.map((member) => member.username)).toEqual(['uatroot', 'MGC695322']);
    expect(result.root).toMatchObject({
      username: 'MGC695322',
      sponsorUsername: 'uatroot',
      placementParentUsername: 'MGC585499',
      placementParentUserId: 'parent-a',
      directChildCount: 0,
    });
    expect(result.members).toEqual([]);
    expect(result.visibleMemberCount).toBe(0); // All A/B/C/D slots OPEN
    const directorySql = String(query.mock.calls[0]?.[0] ?? '');
    expect(directorySql).toContain('LEFT JOIN sponsor_relationships sr');
    expect(directorySql).not.toContain('WHERE own_placement.id IS NULL');
    expect(directorySql).not.toContain('LIMIT 100');
    const memberSql = String(query.mock.calls[3]?.[0] ?? '');
    expect(memberSql).toContain('sponsor.username AS sponsorUsername');
  });

  it('uses true sponsor ID for descendants even when binary parent differs', async () => {
    const query = jest.fn().mockResolvedValueOnce([{
      id: 'root-1', username: 'uatroot', firstName: 'UAT', lastName: 'Root',
      status: 'ACTIVE', createdAt: new Date('2026-10-01T00:00:00.000Z'),
      directChildCount: 4,
    }]).mockResolvedValueOnce([{
      id: 'nested-1', username: 'MGC695322', firstName: 'Ankulat', lastName: '',
      status: 'ACTIVE', parentUserId: 'parent-a', parentUsername: 'MGC585499',
      sponsorUserId: 'root-1', sponsorUsername: 'uatroot',
      slot: 'A', side: 'LEFT', depth: 2, firstLegSlot: 'A', firstLegSide: 'LEFT',
    }]);
    const db = {
      transaction: jest.fn(async (work: (connection: { query: jest.Mock }) => unknown) =>
        work({ query }),
      ),
    };
    const service = new OwnerPortalCoreService(db as never, {} as never, {} as never);
    const result = await service.binaryGenealogy();
    expect(result.members[0]).toMatchObject({
      username: 'MGC695322', sponsorUsername: 'uatroot',
      parentUsername: 'MGC585499', depth: 2, slot: 'A',
    });
  });

});
