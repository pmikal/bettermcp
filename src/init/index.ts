// `bettermcp init` — scaffold a minimal working server in the current directory.

import { existsSync, mkdirSync, openSync, writeSync, closeSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { SCAFFOLDED_FILES, generatePackageJson } from './templates.js'

export interface InitResult {
  created: string[]
  conflicts: string[]
  skipped: boolean
}

/**
 * Scaffold a minimal bettermcp project.
 *
 * @param targetDir - Directory to scaffold into
 * @param force - Overwrite existing files without prompting
 * @returns List of created files and any conflicts detected
 */
export function scaffoldProject(targetDir: string, force = false): InitResult {
  const dir = resolve(targetDir)

  // Ensure target directory exists (supports `bettermcp init my-app`)
  mkdirSync(dir, { recursive: true })

  const dirName = basename(dir) || 'bettermcp-app'

  const allFiles = [
    ...SCAFFOLDED_FILES.map((f) => ({ name: f.name, content: f.content })),
    { name: 'package.json', content: generatePackageJson(dirName) },
  ]

  // When not forcing, use atomic wx flag to detect conflicts at write time
  // (eliminates TOCTOU race between existsSync and writeFileSync)
  if (!force) {
    const conflicts: string[] = []
    const created: string[] = []

    for (const file of allFiles) {
      const filePath = resolve(dir, file.name)
      try {
        const fd = openSync(filePath, 'wx')
        try {
          writeSync(fd, file.content, 0, 'utf8')
        } finally {
          closeSync(fd)
        }
        created.push(file.name)
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
          conflicts.push(file.name)
        } else {
          throw new Error(
            `Failed to write ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }

    if (conflicts.length > 0) {
      // Clean up any files we did create before hitting conflicts
      for (const name of created) {
        try { unlinkSync(resolve(dir, name)) } catch { /* best-effort cleanup */ }
      }
      return { created: [], conflicts, skipped: true }
    }

    return { created, conflicts: [], skipped: false }
  }

  // Force mode: overwrite unconditionally
  const created: string[] = []
  const conflicts: string[] = []
  for (const file of allFiles) {
    const filePath = resolve(dir, file.name)
    if (existsSync(filePath)) {
      conflicts.push(file.name)
    }
    try {
      writeFileSync(filePath, file.content, 'utf8')
      created.push(file.name)
    } catch (err: unknown) {
      throw new Error(
        `Failed to write ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { created, conflicts, skipped: false }
}
