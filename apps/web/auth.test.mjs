import test from "node:test";
import assert from "node:assert/strict";
import { createBasicAuth } from "./auth.mjs";

const request = (authorization) => ({ headers: authorization ? { authorization } : {} });
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

test("auth is optional only when both settings are absent", () => {
  assert.equal(createBasicAuth("", "").required, false);
  assert.equal(createBasicAuth("cesar", "").required, true);
});

test("auth rejects missing and invalid credentials", () => {
  const auth = createBasicAuth("cesar", "correct horse");
  assert.equal(auth.authenticate(request()), null);
  assert.equal(auth.authenticate(request(basic("cesar", "wrong"))), null);
  assert.equal(auth.authenticate(request(basic("other", "correct horse"))), null);
});

test("auth returns the allowlisted identity for valid credentials", () => {
  const auth = createBasicAuth("cesar", "correct horse");
  assert.equal(auth.authenticate(request(basic("cesar", "correct horse"))), "cesar");
});
