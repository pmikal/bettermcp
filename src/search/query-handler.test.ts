import { describe, it, expect, vi } from 'vitest'
import { handleQuery } from './query-handler.js'
import type { ParsedEndpoint } from '../spec/spec-types.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { SignalEntry, ResolutionHint } from '../types/store.js'

function makeEndpoint(overrides: Partial<ParsedEndpoint> = {}): ParsedEndpoint {
  return {
    path: '/pets',
    method: 'GET',
    operationId: 'listPets',
    summary: 'List all pets',
    description: 'Returns a list of pets from the store',
    parameters: [],
    requestBody: null,
    responses: {},
    confidence: { score: 0.8, factors: [] },
    warnings: [],
    ...overrides,
  }
}

function createMockStore(overrides?: Partial<FeedbackStore>): FeedbackStore {
  return {
    insert: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    getHints: vi.fn().mockReturnValue([]),
    insertSignal: vi.fn(),
    getSignals: vi.fn().mockReturnValue([]),
    getSignalsBatch: vi.fn().mockReturnValue(new Map()),
    getHintsBatch: vi.fn().mockReturnValue(new Map()),
    getAllSignals: vi.fn().mockReturnValue([]),
    getVersionStates: vi.fn().mockReturnValue([]),
    insertVersionState: vi.fn(),
    updateVersionState: vi.fn(),
    logPromotion: vi.fn(),
    getPromotionLog: vi.fn().mockReturnValue([]),
    countWireLogs: vi.fn().mockReturnValue(0),
    purgeWireLogsOlderThan: vi.fn().mockReturnValue(0),
    expireSyntheticSignals: vi.fn().mockReturnValue(0),
    close: vi.fn(),
    ...overrides,
  }
}

function createSignal(overrides?: Partial<SignalEntry>): SignalEntry {
  return {
    id: 'sig-1',
    endpoint_path: 'GET /products',
    category: 'missing-error-schema',
    severity: 'low',
    confidence: 0.7,
    observation_count: 0,
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    provenance: 'synthetic',
    message: 'No error schemas defined',
    suggestion: null,
    expired: false,
    ...overrides,
  }
}

function createHint(overrides?: Partial<ResolutionHint>): ResolutionHint {
  return {
    id: 'hint-1',
    endpoint_path: 'GET /products',
    hint: 'Use Accept: application/json header',
    source: 'developer',
    created_at: '2026-01-15T00:00:00.000Z',
    ...overrides,
  }
}

const endpoints: ParsedEndpoint[] = [
  makeEndpoint({
    path: '/pets',
    method: 'GET',
    operationId: 'listPets',
    summary: 'List all pets',
    description: 'Returns a list of pets from the store',
  }),
  makeEndpoint({
    path: '/pets/{petId}',
    method: 'GET',
    operationId: 'getPet',
    summary: 'Get a pet by ID',
    description: 'Returns a single pet',
  }),
  makeEndpoint({
    path: '/pets',
    method: 'POST',
    operationId: 'createPet',
    summary: 'Create a pet',
    description: 'Adds a new pet to the store',
    parameters: [
      { name: 'name', in: 'query', required: true, schema: null, description: 'Pet name' },
    ],
  }),
  makeEndpoint({
    path: '/products',
    method: 'GET',
    operationId: 'listProducts',
    summary: 'List products',
    description: 'Returns available products',
  }),
]

describe('handleQuery', () => {
  it('returns all endpoints when query is empty', () => {
    const results = handleQuery('', endpoints)
    expect(results).toHaveLength(4)
  })

  it('returns all endpoints when query is whitespace', () => {
    const results = handleQuery('   ', endpoints)
    expect(results).toHaveLength(4)
  })

  it('matches by path', () => {
    const results = handleQuery('/products', endpoints)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/products')
  })

  it('matches by method', () => {
    const results = handleQuery('post', endpoints)
    expect(results).toHaveLength(1)
    expect(results[0].method).toBe('POST')
  })

  it('matches by operationId', () => {
    const results = handleQuery('listpets', endpoints)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].operationId).toBe('listPets')
  })

  it('matches by summary', () => {
    const results = handleQuery('create', endpoints)
    expect(results).toHaveLength(1)
    expect(results[0].operationId).toBe('createPet')
  })

  it('matches by description', () => {
    const results = handleQuery('available', endpoints)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].path).toBe('/products')
  })

  it('matches multiple endpoints', () => {
    const results = handleQuery('pet', endpoints)
    // 'pet' appears in path, operationId, summary, description of multiple endpoints
    expect(results.length).toBeGreaterThan(1)
  })

  it('sorts by relevance descending', () => {
    // 'pets' matches path for first 3 endpoints, 'list' matches summary/opId for 2
    const results = handleQuery('pets list', endpoints)
    expect(results.length).toBeGreaterThan(0)
    // First result should have highest relevance (most term matches)
    expect(results[0].operationId).toBe('listPets')
  })

  it('returns empty array for no matches', () => {
    const results = handleQuery('nonexistent', endpoints)
    expect(results).toHaveLength(0)
  })

  it('returns SearchResult shape', () => {
    const results = handleQuery('/products', endpoints)
    expect(results[0]).toEqual({
      path: '/products',
      method: 'GET',
      operationId: 'listProducts',
      summary: 'List products',
      description: 'Returns available products',
      parameters: [],
      confidence: 0.8,
    })
  })

  it('maps parameters correctly', () => {
    const results = handleQuery('createpet', endpoints)
    expect(results).toHaveLength(1)
    expect(results[0].parameters).toEqual([
      { name: 'name', in: 'query', required: true, description: 'Pet name' },
    ])
  })
})

describe('handleQuery with diagnostics', () => {
  it('attaches diagnostics to matching results when includeDiagnostics is true', () => {
    const signal = createSignal()
    const store = createMockStore({
      getSignalsBatch: vi.fn().mockReturnValue(new Map([['GET /products', [signal]]])),
    })

    const results = handleQuery('/products', endpoints, { includeDiagnostics: true, store })

    expect(results).toHaveLength(1)
    expect(results[0].diagnostics).toBeDefined()
    expect(results[0].diagnostics).toHaveLength(1)
    expect(results[0].diagnostics![0]).toEqual({
      category: 'missing-error-schema',
      severity: 'low',
      confidence: 0.7,
      observationCount: 0,
      provenance: 'synthetic',
      message: 'No error schemas defined',
      suggestion: null,
    })
  })

  it('does not include diagnostics when includeDiagnostics is false', () => {
    const store = createMockStore({
      getSignalsBatch: vi.fn().mockReturnValue(new Map([['GET /products', [createSignal()]]])),
    })

    const results = handleQuery('/products', endpoints, { includeDiagnostics: false, store })

    expect(results[0].diagnostics).toBeUndefined()
    expect(results[0].hints).toBeUndefined()
  })

  it('does not include diagnostics when no options provided', () => {
    const results = handleQuery('/products', endpoints)

    expect(results[0].diagnostics).toBeUndefined()
    expect(results[0].hints).toBeUndefined()
  })

  it('attaches hints to matching results', () => {
    const hint = createHint()
    const store = createMockStore({
      getHintsBatch: vi.fn().mockReturnValue(new Map([['GET /products', [hint]]])),
    })

    const results = handleQuery('/products', endpoints, { includeDiagnostics: true, store })

    expect(results[0].hints).toBeDefined()
    expect(results[0].hints).toHaveLength(1)
    expect(results[0].hints![0]).toEqual({
      hint: 'Use Accept: application/json header',
      source: 'developer',
      createdAt: '2026-01-15T00:00:00.000Z',
    })
  })

  it('queries store with correct endpoint key format (METHOD /path)', () => {
    const store = createMockStore()

    handleQuery('/products', endpoints, { includeDiagnostics: true, store })

    expect(store.getSignalsBatch).toHaveBeenCalledWith(['GET /products'])
    expect(store.getHintsBatch).toHaveBeenCalledWith(['GET /products'])
  })

  it('omits diagnostics field when no signals exist for endpoint', () => {
    const store = createMockStore({
      getSignalsBatch: vi.fn().mockReturnValue(new Map()),
      getHintsBatch: vi.fn().mockReturnValue(new Map()),
    })

    const results = handleQuery('/products', endpoints, { includeDiagnostics: true, store })

    expect(results[0].diagnostics).toBeUndefined()
    expect(results[0].hints).toBeUndefined()
  })

  it('distinguishes provenance in diagnostic entries', () => {
    const signals = [
      createSignal({ provenance: 'synthetic', category: 'missing-error-schema' }),
      createSignal({ provenance: 'agent-reported', category: 'timeout', id: 'sig-2' }),
    ]
    const store = createMockStore({
      getSignalsBatch: vi.fn().mockReturnValue(new Map([['GET /products', signals]])),
    })

    const results = handleQuery('/products', endpoints, { includeDiagnostics: true, store })

    expect(results[0].diagnostics).toHaveLength(2)
    expect(results[0].diagnostics![0].provenance).toBe('synthetic')
    expect(results[0].diagnostics![1].provenance).toBe('agent-reported')
  })

  it('returns results without diagnostics when store throws', () => {
    const store = createMockStore({
      getSignalsBatch: vi.fn().mockImplementation(() => { throw new Error('db locked') }),
    })

    const results = handleQuery('/products', endpoints, { includeDiagnostics: true, store })

    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/products')
    expect(results[0].diagnostics).toBeUndefined()
    expect(results[0].hints).toBeUndefined()
  })

  it('includes diagnostics for all matching endpoints', () => {
    const store = createMockStore({
      getSignalsBatch: vi.fn().mockImplementation((keys: string[]) => {
        const map = new Map()
        for (const key of keys) {
          if (key === 'GET /pets') map.set(key, [createSignal({ endpoint_path: 'GET /pets' })])
        }
        return map
      }),
    })

    const results = handleQuery('pet', endpoints, { includeDiagnostics: true, store })

    const withDiag = results.filter((r) => r.diagnostics)
    expect(withDiag.length).toBeGreaterThanOrEqual(1)
    expect(withDiag.some((r) => r.path === '/pets' && r.method === 'GET')).toBe(true)
  })
})
