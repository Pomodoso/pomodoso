// Deterministic ids for `daily` records.
//
// A daily collection holds one record per day. If two devices each fill in
// the same day while offline, random ids would leave two rows for one day
// after sync. Deriving the id from (plugin, collection, day) makes both
// devices write the same row, and LWW picks one — no duplicates, no merge.
//
// UUIDv5 (RFC 9562) over SHA-1, in plain JS: React Native has no
// crypto.subtle, and every client must derive the exact same id.

/** Fixed namespace for daily record ids. Never change it: ids are stored. */
export const PLUGIN_DAILY_NAMESPACE = '754053fe-8e5b-4093-8c09-fafa56f7e936';

function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, ml >>> 0);
  view.setUint32(padded.length - 8, Math.floor(ml / 2 ** 32));

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6];
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
  return out;
}

export function uuidV5(name: string, namespace: string): string {
  const ns = namespace.replace(/-/g, '');
  const nsBytes = Uint8Array.from({ length: 16 }, (_, i) => parseInt(ns.slice(i * 2, i * 2 + 2), 16));
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  input.set(nsBytes);
  input.set(nameBytes, 16);
  const hash = sha1(input).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The id of a daily record: the same on every device for the same day. */
export function dailyRecordId(pluginId: string, collection: string, day: string): string {
  return uuidV5(`${pluginId}:${collection}:${day}`, PLUGIN_DAILY_NAMESPACE);
}
