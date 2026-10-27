// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) μόνο με WebCrypto — χωρίς εξωτερικές βιβλιοθήκες.
// Δουλεύει σε Deno (Supabase Edge Functions) και σε Node 20+.

const te = new TextEncoder();

export function b64uToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64u(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* VAPID: υπογραφή JWT (ES256) με το ιδιωτικό κλειδί του διακομιστή */
async function vapidHeader(endpoint: string, pub: string, priv: string, subject: string): Promise<string> {
  const p = b64uToBytes(pub);
  const jwk = { kty: 'EC', crv: 'P-256', d: priv, x: bytesToB64u(p.slice(1, 33)), y: bytesToB64u(p.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = bytesToB64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64u(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body)));
  return 'vapid t=' + head + '.' + body + '.' + bytesToB64u(sig) + ', k=' + pub;
}

/* Κρυπτογράφηση μηνύματος για τη συγκεκριμένη συσκευή (aes128gcm) */
export async function encrypt(payload: Uint8Array, p256dh: string, authSecret: string, salt?: Uint8Array, asKeys?: CryptoKeyPair) {
  const uaPub = b64uToBytes(p256dh);
  const auth = b64uToBytes(authSecret);
  const as = asKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, concat(te.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, te.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
  const nonce = (await hmac(prk, te.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export interface Sub { endpoint: string; p256dh: string; auth: string }
export interface Vapid { publicKey: string; privateKey: string; subject: string }

export async function sendPush(sub: Sub, data: unknown, vapid: Vapid, ttl = 3600): Promise<{ status: number; text: string }> {
  const body = await encrypt(te.encode(JSON.stringify(data)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': String(ttl),
      'Urgency': 'high',
      'Authorization': await vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject)
    },
    body
  });
  let text = '';
  try { text = await res.text(); } catch (_) { /* */ }
  return { status: res.status, text };
}
