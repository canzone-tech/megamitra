export interface AuthUser {
  id: string;
  sessionId: string;
  username: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

export interface JwtPayload {
  sub: string;
  sid: string;
  typ: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}
