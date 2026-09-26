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
    };
    return {
      service: new OwnerPortalCoreService(db as never, portal as never),
      db,
      portal,
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
});
