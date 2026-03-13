/**
 * Matches a live request path against an OpenAPI spec template path.
 * Handles parameterized segments like /users/{id}/posts/{postId}.
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Converts an OpenAPI path template to a RegExp.
 * E.g., "/users/{id}" → /^\/users\/[^/]+$/
 */
function templateToRegex(templatePath: string): RegExp {
  const segments = templatePath.split('/')
  const pattern = segments
    .map((seg) =>
      seg.startsWith('{') && seg.endsWith('}') ? '[^/]+' : escapeRegex(seg),
    )
    .join('/')
  return new RegExp(`^${pattern}$`)
}

/**
 * Tests whether a live request path matches a spec template path.
 * Exact match is tried first as a fast path.
 */
export function matchesTemplatePath(
  specPath: string,
  requestPath: string,
): boolean {
  if (specPath === requestPath) return true
  return templateToRegex(specPath).test(requestPath)
}

export interface CompiledPathMatcher {
  specPath: string
  regex: RegExp
}

/**
 * Pre-compiles path templates into regexes for efficient repeated matching.
 */
export function compilePathMatchers(
  specPaths: string[],
): CompiledPathMatcher[] {
  return specPaths.map((specPath) => ({
    specPath,
    regex: templateToRegex(specPath),
  }))
}

/**
 * Finds the spec path that matches a live request path,
 * using pre-compiled matchers.
 */
export function findMatchingPath(
  matchers: CompiledPathMatcher[],
  requestPath: string,
): string | null {
  for (const matcher of matchers) {
    if (matcher.specPath === requestPath || matcher.regex.test(requestPath)) {
      return matcher.specPath
    }
  }
  return null
}
