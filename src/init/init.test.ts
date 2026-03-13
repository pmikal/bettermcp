import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scaffoldProject } from './index.js'

describe('scaffoldProject', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('creates petstore.yaml, server.js, and package.json in target directory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    const result = scaffoldProject(tmpDir)

    expect(result.skipped).toBe(false)
    expect(result.created).toContain('petstore.yaml')
    expect(result.created).toContain('server.js')
    expect(result.created).toContain('package.json')
    expect(result.conflicts).toHaveLength(0)

    expect(existsSync(join(tmpDir, 'petstore.yaml'))).toBe(true)
    expect(existsSync(join(tmpDir, 'server.js'))).toBe(true)
    expect(existsSync(join(tmpDir, 'package.json'))).toBe(true)
  })

  it('creates target directory if it does not exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    const subDir = join(tmpDir, 'my-new-app')

    const result = scaffoldProject(subDir)

    expect(result.skipped).toBe(false)
    expect(result.created).toHaveLength(3)
    expect(existsSync(join(subDir, 'server.js'))).toBe(true)
  })

  it('petstore.yaml is valid OpenAPI 3.0', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    scaffoldProject(tmpDir)

    const spec = readFileSync(join(tmpDir, 'petstore.yaml'), 'utf8')
    expect(spec).toContain('openapi: "3.0.3"')
    expect(spec).toContain('/pets')
    expect(spec).toContain('listPets')
    expect(spec).toContain('createPet')
    expect(spec).toContain('getPet')
  })

  it('server.js imports bettermcp and calls loadSpec + start', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    scaffoldProject(tmpDir)

    const server = readFileSync(join(tmpDir, 'server.js'), 'utf8')
    expect(server).toContain("from 'bettermcp'")
    expect(server).toContain('loadSpec')
    expect(server).toContain('start()')
  })

  it('package.json has bettermcp dependency, start script, and engines', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    scaffoldProject(tmpDir)

    const pkg = JSON.parse(readFileSync(join(tmpDir, 'package.json'), 'utf8'))
    expect(pkg.type).toBe('module')
    expect(pkg.dependencies.bettermcp).toBe('latest')
    expect(pkg.scripts.start).toBe('node server.js')
    expect(pkg.engines.node).toBe('>=20')
  })

  it('package.json name is sanitized from directory name', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'my-api-project-'))
    scaffoldProject(tmpDir)

    const pkg = JSON.parse(readFileSync(join(tmpDir, 'package.json'), 'utf8'))
    expect(pkg.name).toContain('my-api-project')
    // Should be lowercase, no invalid chars
    expect(pkg.name).toMatch(/^[a-z][a-z0-9-_.~]*$/)
  })

  it('sanitizes directory names with spaces and uppercase', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    const subDir = join(tmpDir, 'My Cool App')

    scaffoldProject(subDir)

    const pkg = JSON.parse(readFileSync(join(subDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('my-cool-app')
  })

  it('detects conflicts and cleans up without --force', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    writeFileSync(join(tmpDir, 'server.js'), 'existing content', 'utf8')

    const result = scaffoldProject(tmpDir)

    expect(result.skipped).toBe(true)
    expect(result.conflicts).toContain('server.js')
    expect(result.created).toHaveLength(0)
    // Original file untouched
    expect(readFileSync(join(tmpDir, 'server.js'), 'utf8')).toBe('existing content')
    // Files written before the conflict are cleaned up
    expect(existsSync(join(tmpDir, 'petstore.yaml'))).toBe(false)
  })

  it('overwrites conflicts with force flag', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    writeFileSync(join(tmpDir, 'server.js'), 'old content', 'utf8')

    const result = scaffoldProject(tmpDir, true)

    expect(result.skipped).toBe(false)
    expect(result.conflicts).toContain('server.js')
    expect(result.created).toContain('server.js')
    // File overwritten
    const newContent = readFileSync(join(tmpDir, 'server.js'), 'utf8')
    expect(newContent).toContain("from 'bettermcp'")
  })

  it('detects multiple conflicts', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bettermcp-init-'))
    writeFileSync(join(tmpDir, 'server.js'), 'x', 'utf8')
    writeFileSync(join(tmpDir, 'package.json'), '{}', 'utf8')

    const result = scaffoldProject(tmpDir)

    expect(result.skipped).toBe(true)
    expect(result.conflicts).toContain('server.js')
    expect(result.conflicts).toContain('package.json')
  })
})
