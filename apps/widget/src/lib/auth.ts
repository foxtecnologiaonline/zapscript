import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

function jwtSecret(): string {
  const secret = process.env.WIDGET_JWT_SECRET;
  if (!secret) throw new Error('WIDGET_JWT_SECRET não configurado');
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface AuthTokenPayload {
  agentId: string;
  clientId: string;
  role: string;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, jwtSecret()) as AuthTokenPayload;
  } catch {
    return null;
  }
}

/** Lê e valida o Bearer token do header Authorization de uma rota /api. */
export function requireAuth(req: NextRequest): AuthTokenPayload | null {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  return verifyToken(token);
}
