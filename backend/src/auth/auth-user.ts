export interface AuthUser {
  id: string;
  sessionId: string;
  username: string;
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
