// Defense-in-depth CSRF guard.
//
// The auth stack is already protected against trivial CSRF because:
//   • Cookies are signed + httpOnly + sameSite=lax. Cross-site fetch() and
//     XHR from a third-party origin do NOT receive the cookie at all.
//   • The frontend prefers the Authorization: Bearer header anyway.
//
// This middleware adds a second line by rejecting mutating requests
// (POST/PUT/PATCH/DELETE) when:
//   • the request carries an auth cookie (signedCookies.token) and
//   • the request has an Origin header and
//   • that Origin is NOT in the CORS allowlist.
//
// We deliberately do NOT require Origin (some legacy clients omit it).
// We also do NOT apply this to webhook routes — those are signature-based
// and have no cookie.

export function makeOriginGuard(allowlist) {
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  return function originGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    // Only kick in if the caller relied on the cookie for auth. Bearer
    // header callers are immune to drive-by attacks because browsers
    // don't auto-attach Authorization headers cross-origin.
    if (!req.signedCookies?.token) return next();

    const rawOrigin = req.headers.origin || req.headers.referer;
    // For a cookie-auth mutating request from a real first-party SPA,
    // the browser ALWAYS sends Origin on POST/PUT/PATCH/DELETE. The lack
    // of one is a CSRF telltale — block conservatively.
    if (!rawOrigin) {
      return res.status(403).json({
        success: false,
        error: { code: 'ORIGIN_REQUIRED', message: 'Falta la cabecera Origin/Referer.' }
      });
    }
    try {
      const url = new URL(rawOrigin);
      const normalized = `${url.protocol}//${url.host}`;
      if (allowlist.includes(normalized)) return next();
    } catch { /* malformed → fall through to reject */ }
    return res.status(403).json({
      success: false,
      error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origen no permitido para esta acción.' }
    });
  };
}
