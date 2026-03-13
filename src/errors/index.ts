import { ErrorCatalog, getDocsUrl } from './catalog.js'
import type { ErrorCode } from './catalog.js'

export type { ErrorCode }

export class BetterMCPError extends Error {
  readonly code: string
  readonly problem: string
  readonly fix: string
  readonly docsUrl: string

  constructor(entry: { code: string; problem: string; fix: string; docsUrl: string; cause?: unknown }) {
    super(`[${entry.code}] ${entry.problem}`, { cause: entry.cause })
    this.name = 'BetterMCPError'
    this.code = entry.code
    this.problem = entry.problem
    this.fix = entry.fix
    this.docsUrl = entry.docsUrl
  }
}

export function createError(
  errorCode: ErrorCode,
  ...args: [...detail: string[], options: { cause: unknown }]
): BetterMCPError
export function createError(errorCode: ErrorCode, ...args: string[]): BetterMCPError
export function createError(errorCode: ErrorCode, ...args: unknown[]): BetterMCPError {
  const entry = ErrorCatalog[errorCode]
  const problemFn = entry.problem as (...a: string[]) => string

  // If last arg is an options object with cause, extract it
  let cause: unknown
  let detail: string[]
  const lastArg = args[args.length - 1]
  if (lastArg !== null && typeof lastArg === 'object' && 'cause' in lastArg) {
    cause = (lastArg as { cause: unknown }).cause
    detail = args.slice(0, -1) as string[]
  } else {
    detail = args as string[]
  }

  return new BetterMCPError({
    code: entry.code,
    problem: problemFn(...detail),
    fix: entry.fix,
    docsUrl: getDocsUrl(entry.docsPath),
    cause,
  })
}
