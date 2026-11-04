import { randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
export function createAuth(token, { now = Date.now, ttl = 8 * 60 * 60 * 1000, passwordHash = '' } = {}) {
  const sessions = new Map();
  const enabled = Boolean(token || passwordHash);
  const equal = value => {
    if (typeof value !== 'string' || !value || value.length > 1024) return false;
    if (token) { const a=Buffer.from(value); const b=Buffer.from(token); return a.length===b.length && timingSafeEqual(a,b); }
    if (!passwordHash) return false;
    const [salt, hash] = passwordHash.split(':');
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(value, salt, 32);
    return expected.length===actual.length && timingSafeEqual(actual,expected);
  };
  const sessionId = req => String(req.headers.cookie || '').match(/(?:^|;\s*)studio_session=([^;]+)/)?.[1];
  return {
    enabled,
    authorized(req) {
      if (!enabled || (token && equal(req.headers['x-studio-token']))) return true;
      const id=sessionId(req); const expires=sessions.get(id);
      if (!expires || expires<=now()) { sessions.delete(id); return false; }
      return true;
    },
    login(value) {
      if (!equal(value)) return null;
      for (const [id,expires] of sessions) if(expires<=now()) sessions.delete(id);
      const id=randomBytes(32).toString('hex'); sessions.set(id,now()+ttl); return id;
    },
    logout(req) { sessions.delete(sessionId(req)); },
    cookie(id, secure = false) { return `studio_session=${id || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${id ? Math.floor(ttl/1000) : 0}${secure ? '; Secure' : ''}`; },
  };
}
export function sameOriginRequest(req) {
  if (req.headers['sec-fetch-site']==='cross-site') return false;
  if (!req.headers.origin) return true;
  try { const origin=new URL(req.headers.origin); return ['http:','https:'].includes(origin.protocol) && origin.host===req.headers.host; } catch { return false; }
}
