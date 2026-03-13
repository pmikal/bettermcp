/**
 * Re-export from canonical location for backward compatibility.
 * The path-matcher module lives in src/utils/ since it is shared across modules.
 */
export { matchesTemplatePath, compilePathMatchers, findMatchingPath } from '../utils/path-matcher.js'
export type { CompiledPathMatcher } from '../utils/path-matcher.js'
