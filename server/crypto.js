import crypto from "node:crypto";

// OAuth tokens are encrypted at rest with AES-256-GCM using TOKEN_SECRET.
function key() {
  const hex = process.env.TOKEN_SECRET;
  if (!hex || hex.length !== 64) throw new Error("TOKEN_SECRET must be 64 hex characters");
  return Buffer.from(hex, "hex");
}

export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload) {
  const [iv, tag, data] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
}
