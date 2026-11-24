const enc = new TextEncoder();

export function b64u(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ITER = 100000; // Workers' maximum for PBKDF2

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(password, salt, ITER);
  return `pbkdf2$${ITER}$${b64u(salt)}$${b64u(h)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, it, s, h] = stored.split('$');
  if (alg !== 'pbkdf2' || !it || !s || !h) return false;
  const d = await pbkdf2(password, fromB64u(s), Number(it));
  return safeEqual(d, fromB64u(h));
}

export async function sha256(s: string): Promise<string> {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64u(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, any> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC', await hmacKey(secret, 'verify'), fromB64u(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64u(parts[1])));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
