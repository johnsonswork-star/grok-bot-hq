// End-to-end encryption for HQ chat (WebCrypto: ECDH P-256 + AES-256-GCM). Same file runs in Safari and Node 20.
// seal(obj, recipientPubJwk) -> envelope {v,epk,iv,ct}; open(envelope, myPrivateKey) -> obj
const S = globalThis.crypto.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => { let s = ''; for (const b of new Uint8Array(u8)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const EC = { name: 'ECDH', namedCurve: 'P-256' };
const pubOnly = j => ({ kty: 'EC', crv: 'P-256', x: j.x, y: j.y });

export const importPub = jwk => S.importKey('jwk', pubOnly(jwk), EC, true, []);
export const importPriv = jwk => S.importKey('jwk', jwk, EC, false, ['deriveKey']);
export async function newKeyPair() {
  const k = await S.generateKey(EC, true, ['deriveKey']);
  return { privJwk: await S.exportKey('jwk', k.privateKey), pubJwk: pubOnly(await S.exportKey('jwk', k.publicKey)) };
}
const aes = (priv, pub, use) => S.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, [use]);

export async function seal(obj, recipientPubJwk) {
  const eph = await S.generateKey(EC, true, ['deriveKey']);
  const key = await aes(eph.privateKey, await importPub(recipientPubJwk), 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await S.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, epk: pubOnly(await S.exportKey('jwk', eph.publicKey)), iv: b64(iv), ct: b64(ct) };
}
export async function open(env, myPrivKey) {
  const key = await aes(myPrivKey, await importPub(env.epk), 'decrypt');
  const pt = await S.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
  return JSON.parse(dec.decode(pt));
}
export const randomId = (n = 18) => b64(globalThis.crypto.getRandomValues(new Uint8Array(n)));
