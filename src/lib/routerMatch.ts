/**
 * Pure URL path matching helpers for the lightweight History API router.
 * Kept free of React / DOM imports so it can be unit-tested in plain Node.
 */

function normalizePath(path: string): string {
  // Strip query string and hash if present.
  const withoutHash = path.split('#', 1)[0];
  const pathname = withoutHash.split('?', 1)[0];
  if (pathname === '' || pathname === '/') return '/';
  const collapsed = pathname.replace(/\/+$/, '');
  return collapsed === '' ? '/' : collapsed;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Matches a route pattern (supporting exact segments, `:param` dynamic segments,
 * and `*` wildcard fallback) against a URL pathname.
 * Returns extracted params on match, or `null` when it does not match.
 */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const normPattern = normalizePath(pattern);
  const normPath = normalizePath(pathname);

  if (normPattern === '*' || normPattern === '/*') {
    return {};
  }

  if (normPattern === '/' && normPath === '/') {
    return {};
  }

  const patternSegments = normPattern === '/' ? [] : normPattern.slice(1).split('/');
  const pathSegments = normPath === '/' ? [] : normPath.slice(1).split('/');

  const hasTrailingWildcard =
    patternSegments.length > 0 && patternSegments[patternSegments.length - 1] === '*';

  if (hasTrailingWildcard) {
    const prefixSegments = patternSegments.slice(0, -1);
    if (pathSegments.length < prefixSegments.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < prefixSegments.length; i++) {
      const pSeg = prefixSegments[i];
      const uSeg = pathSegments[i];
      if (pSeg.startsWith(':') && pSeg.length > 1) {
        params[pSeg.slice(1)] = safeDecode(uSeg);
      } else if (pSeg !== uSeg) {
        return null;
      }
    }
    params['*'] = pathSegments.slice(prefixSegments.length).map(safeDecode).join('/');
    return params;
  }

  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const pSeg = patternSegments[i];
    const uSeg = pathSegments[i];
    if (pSeg.startsWith(':') && pSeg.length > 1) {
      params[pSeg.slice(1)] = safeDecode(uSeg);
    } else if (pSeg !== uSeg) {
      return null;
    }
  }

  return params;
}

/**
 * Determines whether a `<NavLink to={to} end={end} />` should be marked active
 * for the current `pathname`.
 */
export function isNavLinkActive(to: string, pathname: string, end = false): boolean {
  const normTo = normalizePath(to);
  const normPath = normalizePath(pathname);

  if (end) {
    return normPath === normTo;
  }

  if (normTo === '/') {
    return true;
  }

  return normPath === normTo || normPath.startsWith(`${normTo}/`);
}
