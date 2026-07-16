import type { Request, Response, NextFunction } from 'express';
import type { Role, User } from '@prisma/client';
import { SESSION_COOKIE_NAME, getUserForSessionToken } from '../lib/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }

  const user = await getUserForSessionToken(token);
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }

  req.user = user;
  next();
}

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
