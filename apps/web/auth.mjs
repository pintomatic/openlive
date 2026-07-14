import { timingSafeEqual } from "node:crypto";

function sameSecret(actual, expected) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createBasicAuth(user, password) {
  const expectedUser = String(user || "").trim();
  const expectedPassword = String(password || "").trim();
  const required = !!(expectedUser || expectedPassword);
  return {
    required,
    authenticate(req) {
      if (!required) return "";
      if (!expectedUser || !expectedPassword) return null;
      const raw = String(req.headers?.authorization || "");
      if (!raw.startsWith("Basic ")) return null;
      let decoded = "";
      try { decoded = Buffer.from(raw.slice(6), "base64").toString("utf8"); } catch { return null; }
      const split = decoded.indexOf(":");
      if (split < 0) return null;
      const actualUser = decoded.slice(0, split);
      const actualPassword = decoded.slice(split + 1);
      return sameSecret(actualUser, expectedUser) && sameSecret(actualPassword, expectedPassword) ? expectedUser : null;
    },
  };
}

export function rejectBasicAuth(res) {
  res.writeHead(401, { "www-authenticate": 'Basic realm="OpenLive", charset="UTF-8"', "content-type": "text/plain" });
  res.end("Authentication required.");
}
