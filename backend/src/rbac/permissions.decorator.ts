import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'megamitra:permissions';
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
