export function requiresBasicAuth(pathname, basicAuthConfigured, webauthnEnforced) {
  if (!basicAuthConfigured) return false;
  return !webauthnEnforced || pathname === "/auth/recovery";
}
