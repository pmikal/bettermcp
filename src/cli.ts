#!/usr/bin/env node

// bettermcp CLI entry point
// Minimal argv parsing — no heavy CLI framework dependency.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createStore } from './store/index.js'
import { resolveConfig } from './config/index.js'
import { promoteEndpoint } from './safe-mode/promote.js'
import { classify } from './triage/classifier.js'
import { formatReport, formatVersionReport } from './triage/formatter.js'
import { buildVersionReport } from './triage/version-reporter.js'
import { formatIssues, formatDryRun } from './triage/issue-formatter.js'
import { createGitHubIssues } from './triage/github-issues.js'
import { scaffoldProject } from './init/index.js'

const args = process.argv.slice(2)
const command = args[0]

// Warn early if --db is the last argument with no value provided
if (args.length > 0 && args[args.length - 1] === '--db') {
  process.stderr.write('Warning: --db is the last argument but no path value was provided.\n')
}

/** Parse triage subcommand flags from argv. */
function parseTriageFlags(argv: string[]): { dbPath: string | undefined; versions: boolean; github: boolean } {
  let dbPath: string | undefined
  let versions = false
  let github = false

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--db') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        dbPath = next
        i++ // skip consumed value
      } else {
        process.stderr.write('Error: --db requires a path value.\n')
        process.exit(1)
      }
    } else if (arg.startsWith('--db=')) {
      const val = arg.slice('--db='.length)
      if (val) {
        dbPath = val
      } else {
        process.stderr.write('Error: --db requires a path value.\n')
        process.exit(1)
      }
    } else if (arg === '--versions') {
      versions = true
    } else if (arg === '--github') {
      github = true
    } else if (arg.startsWith('--')) {
      process.stderr.write(`Error: unknown flag: ${arg}\n`)
      process.exit(1)
    }
  }

  return { dbPath, versions, github }
}

/**
 * Resolve the database path from an explicit --db flag or config fallback.
 * Validates that explicitly provided paths exist on disk.
 */
function resolveDbPath(explicitDbPath: string | undefined): string {
  if (explicitDbPath) {
    if (!existsSync(explicitDbPath)) {
      process.stderr.write(`Error: database not found at ${explicitDbPath}\n`)
      process.exit(1)
    }
    return explicitDbPath
  }
  try {
    const config = resolveConfig()
    return config.db
  } catch (err) {
    process.stderr.write(
      `Error resolving config: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}

if (command === 'promote') {
  const method = args[1]
  const path = args[2]

  if (!method || !path) {
    process.stderr.write(
      'Usage: bettermcp promote <METHOD> <path>\n' +
        'Example: bettermcp promote POST /orders\n',
    )
    process.exit(1)
  }

  if (args.length > 3) {
    process.stderr.write(
      'Error: path must be a single argument. Quote compound paths if needed.\n' +
        'Usage: bettermcp promote <METHOD> <path>\n',
    )
    process.exit(1)
  }

  const config = resolveConfig()
  const store = createStore(config.db)

  try {
    const result = promoteEndpoint(
      method,
      path,
      store,
      config.safeMode,
    )

    if (result.message) {
      process.stdout.write(`${result.message}\n`)
    } else if (result.alreadyLive) {
      process.stdout.write(
        `${result.endpointKey} is already in live mode.\n`,
      )
    } else {
      process.stdout.write(
        `Promoted ${result.endpointKey} from simulate → live.\n`,
      )
    }
  } catch (err) {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  } finally {
    store.close()
  }
} else if (command === 'triage') {
  const flags = parseTriageFlags(args)
  const dbPath = resolveDbPath(flags.dbPath)
  const store = createStore(dbPath)

  try {
    const report = classify(store)
    process.stdout.write(formatReport(report))

    if (flags.versions) {
      const versionReport = buildVersionReport(store)
      process.stdout.write('\n')
      process.stdout.write(formatVersionReport(versionReport))
    }

    if (flags.github && report.entries.length > 0) {
      const issues = formatIssues(report.entries)
      const result = createGitHubIssues(issues)

      if (result.dryRun) {
        process.stdout.write('\n')
        process.stdout.write(formatDryRun(issues))
      } else {
        if (result.created.length > 0) {
          process.stdout.write(`\nCreated ${result.created.length} GitHub issue(s):\n`)
          for (const url of result.created) {
            process.stdout.write(`  ${url}\n`)
          }
        }
        if (result.skipped.length > 0) {
          process.stdout.write(`\nSkipped ${result.skipped.length} duplicate(s):\n`)
          for (const title of result.skipped) {
            process.stdout.write(`  ${title}\n`)
          }
        }
      }
    }
  } catch (err) {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  } finally {
    store.close()
  }
} else if (command === 'versions') {
  const flags = parseTriageFlags(args)

  if (flags.versions || flags.github) {
    process.stderr.write('Warning: --versions and --github flags are only valid for the triage command.\n')
  }

  const dbPath = resolveDbPath(flags.dbPath)
  const store = createStore(dbPath)

  try {
    const versionReport = buildVersionReport(store)
    process.stdout.write(formatVersionReport(versionReport))
  } catch (err) {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  } finally {
    store.close()
  }
} else if (command === 'init') {
  const force = args.includes('--force')
  // Optional directory argument: `bettermcp init my-app`
  const dirArg = args.find((a, i) => i > 0 && !a.startsWith('--'))
  const targetDir = dirArg ? resolve(process.cwd(), dirArg) : process.cwd()

  const result = scaffoldProject(targetDir, force)

  if (result.skipped) {
    process.stderr.write(
      'The following files already exist:\n' +
        result.conflicts.map((f) => `  ${f}\n`).join('') +
        '\nUse --force to overwrite.\n',
    )
    process.exit(1)
  }

  process.stdout.write('Created bettermcp project:\n')
  for (const file of result.created) {
    process.stdout.write(`  ${file}\n`)
  }
  process.stdout.write(
    '\nNext steps:\n' +
      '  npm install\n' +
      '  npm start\n',
  )
} else {
  process.stdout.write(
    'bettermcp CLI\n\n' +
      'Commands:\n' +
      '  init [dir] [--force]             Scaffold a minimal bettermcp project\n' +
      '  promote <METHOD> <path>          Promote an endpoint from simulate to live\n' +
      '  triage [options]                 Generate a triage classification report\n' +
      '  versions [--db <path>]            List pinned versions with lifecycle state\n\n' +
      'Init options:\n' +
      '  --force                          Overwrite existing files\n\n' +
      'Triage options:\n' +
      '  --db <path>                      Path to feedback database\n' +
      '  --versions                       Include version lifecycle status\n' +
      '  --github                         Create GitHub issues from findings\n\n' +
      'Versions options:\n' +
      '  --db <path>                      Path to feedback database\n\n' +
      'Examples:\n' +
      '  npx bettermcp init\n' +
      '  npx bettermcp init my-app\n' +
      '  npx bettermcp promote POST /orders\n' +
      '  npx bettermcp triage --db ./feedback.db\n' +
      '  npx bettermcp triage --versions\n' +
      '  npx bettermcp triage --github\n' +
      '  npx bettermcp versions --db ./feedback.db\n',
  )
  if (command && command !== '--help' && command !== '-h') {
    process.stderr.write(`\nUnknown command: ${command}\n`)
    process.exit(1)
  }
}
