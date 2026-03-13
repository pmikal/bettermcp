import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createStore } from './store/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = resolve(__dirname, '../dist/cli.js')

function run(...args: string[]) {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  }
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(
      'dist/cli.js not found — run `npm run build` before tests. ' +
      'CLI integration tests require the compiled output.',
    )
  }
})

describe('CLI', () => {
  describe('help', () => {
    it('shows help text including versions command', () => {
      const result = run()
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('versions')
      expect(result.stdout).toContain('List pinned versions with lifecycle state')
    })

    it('shows help for --help flag', () => {
      const result = run('--help')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('versions')
    })

    it('exits with error for unknown command', () => {
      const result = run('notacommand')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Unknown command: notacommand')
    })
  })

  describe('versions', () => {
    let tmpDir: string
    let dbPath: string

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-cli-test-'))
      dbPath = join(tmpDir, 'test.db')
      // Create an empty database with the expected schema
      const store = createStore(dbPath)
      store.close()
    })

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('outputs version report for valid database', () => {
      const result = run('versions', '--db', dbPath)
      expect(result.exitCode).toBe(0)
      // Empty db → "No version pinning configured."
      expect(result.stdout).toContain('No version pinning configured')
    })

    it('rejects unknown flags', () => {
      const result = run('versions', '--unknown')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('unknown flag: --unknown')
    })

    it('errors when --db points to nonexistent file', () => {
      const result = run('versions', '--db', '/nonexistent/path/to/db.sqlite')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('database not found')
    })

    it('warns when triage-only flags are used', () => {
      const result = run('versions', '--github', '--db', dbPath)
      expect(result.stderr).toContain('only valid for the triage command')
    })

    it('errors when --db is missing a value', () => {
      const result = run('versions', '--db')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('--db requires a path value')
    })

    it('accepts --db=value syntax', () => {
      const result = run('versions', `--db=${dbPath}`)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No version pinning configured')
    })
  })

  describe('init', () => {
    let tmpDir: string

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-cli-init-'))
    })

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('scaffolds a project in the current directory', () => {
      const initDir = mkdtempSync(join(tmpDir, 'empty-'))
      const result = spawnSync('node', [CLI, 'init'], {
        encoding: 'utf8',
        timeout: 10_000,
        cwd: initDir,
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('petstore.yaml')
      expect(result.stdout).toContain('server.js')
      expect(result.stdout).toContain('package.json')
      expect(result.stdout).toContain('npm install')
      expect(existsSync(join(initDir, 'petstore.yaml'))).toBe(true)
      expect(existsSync(join(initDir, 'server.js'))).toBe(true)
      expect(existsSync(join(initDir, 'package.json'))).toBe(true)
    })

    it('exits with error when files conflict', () => {
      const conflictDir = mkdtempSync(join(tmpDir, 'conflict-'))
      writeFileSync(join(conflictDir, 'server.js'), 'existing', 'utf8')
      const result = spawnSync('node', [CLI, 'init'], {
        encoding: 'utf8',
        timeout: 10_000,
        cwd: conflictDir,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('server.js')
      expect(result.stderr).toContain('--force')
    })

    it('overwrites with --force', () => {
      const forceDir = mkdtempSync(join(tmpDir, 'force-'))
      writeFileSync(join(forceDir, 'server.js'), 'old', 'utf8')
      const result = spawnSync('node', [CLI, 'init', '--force'], {
        encoding: 'utf8',
        timeout: 10_000,
        cwd: forceDir,
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('server.js')
    })

    it('accepts a directory argument and creates it', () => {
      const parentDir = mkdtempSync(join(tmpDir, 'parent-'))
      const newDir = join(parentDir, 'my-app')
      const result = spawnSync('node', [CLI, 'init', 'my-app'], {
        encoding: 'utf8',
        timeout: 10_000,
        cwd: parentDir,
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('petstore.yaml')
      expect(existsSync(join(newDir, 'server.js'))).toBe(true)
    })
  })

  describe('triage', () => {
    it('rejects unknown flags', () => {
      const result = run('triage', '--unknown')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('unknown flag: --unknown')
    })
  })
})
