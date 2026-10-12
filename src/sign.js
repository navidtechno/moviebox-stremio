// MovieBox request signing (HMAC-MD5), reverse-engineered from the MovieBox APK.
// Signature header:  x-tr-signature: {timestamp_ms}|2|{base64(hmac_md5(key, message))}
// Canonical message (newline-separated):
//   METHOD \n accept \n content-type \n body_byte_length \n timestamp_ms \n body_md5_hex \n normalized_path
// where normalized_path = pathname + "?" + alphabetically-sorted query string.
// The HMAC key below is the default production key shipped in the APK (base64-decoded before use).
// Alternate key (unused): Xqn2nnO41/L92o1iuXhSLHTbXvY4Z5ZZ62m8mSLA

const { createHmac, createHash } = require("node:crypto");

const KEY = Buffer.from("76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O", "base64");

function normalizePath(url) {
  const u = new URL(url);
  const entries = [...u.searchParams.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  if (!entries.length) return u.pathname;
  return u.pathname + "?" + entries.map(([k, v]) => `${k}=${v}`).join("&");
}

function sign(url, { method = "GET", accept = "", contentType = "", body = "" } = {}) {
  const ts = String(Date.now());
  let bodyLen = "";
  let bodyMd5 = "";
  if (body) {
    const bytes = Buffer.from(body, "utf-8");
    bodyLen = String(bytes.length);
    bodyMd5 = createHash("md5").update(bytes).digest("hex");
  }
  const message = [
    method.toUpperCase(),
    accept,
    contentType,
    bodyLen,
    ts,
    bodyMd5,
    normalizePath(url),
  ].join("\n");
  const mac = createHmac("md5", KEY).update(message, "utf-8").digest("base64");
  return `${ts}|2|${mac}`;
}

// X-Client-Token header: {ts},{md5hex(reverse(ts))}
function clientToken() {
  const ts = String(Date.now());
  const rev = ts.split("").reverse().join("");
  return `${ts},${createHash("md5").update(rev).digest("hex")}`;
}

module.exports = { sign, clientToken, normalizePath };
