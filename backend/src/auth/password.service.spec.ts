import { PasswordService } from './password.service';

describe('PasswordService', () => {
  it('hashes and verifies a password', async () => {
    const service = new PasswordService();
    const hash = await service.hash('MegaMitra-Test-Password-123!');

    expect(hash).not.toContain('MegaMitra-Test-Password-123!');
    await expect(service.verify(hash, 'MegaMitra-Test-Password-123!')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });
});
