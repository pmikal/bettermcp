import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import { createStore } from './index.js'
import { NodeStore } from './node-store.js'

const TEST_DB = './test-factory.db'

describe('createStore factory', () => {
  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`)
    if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`)
  })

  it('returns NodeStore when running in Node.js', () => {
    const store = createStore(TEST_DB)
    expect(store).toBeInstanceOf(NodeStore)
    store.close()
  })

  it('creates a functional store', () => {
    const store = createStore(TEST_DB)
    expect(existsSync(TEST_DB)).toBe(true)
    store.close()
  })
})
