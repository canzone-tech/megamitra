import 'reflect-metadata';
import { REQUIRED_ROLES_KEY } from '../rbac/roles.decorator';
import { AdminMemberPaymentController } from './member-payment.controller';

describe('AdminMemberPaymentController payment review authorization', () => {
  it('requires SUPER_ADMIN for payment verification', () => {
    const roles = Reflect.getMetadata(
      REQUIRED_ROLES_KEY,
      AdminMemberPaymentController.prototype.review,
    ) as string[] | undefined;

    expect(roles).toEqual(['SUPER_ADMIN']);
  });
});
