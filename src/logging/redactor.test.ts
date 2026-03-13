import { describe, it, expect } from 'vitest'
import { redactHeaders, redactBody, redactWireEntry } from './redactor.js'

describe('redactHeaders', () => {
  it('redacts Authorization header', () => {
    const headers = { Authorization: 'Bearer eyJtoken123', Accept: 'application/json' }
    const result = redactHeaders(headers)
    expect(result['Authorization']).toBe('[REDACTED]')
    expect(result['Accept']).toBe('application/json')
  })

  it('redacts Cookie header', () => {
    const result = redactHeaders({ Cookie: 'session=abc123' })
    expect(result['Cookie']).toBe('[REDACTED]')
  })

  it('redacts Set-Cookie header', () => {
    const result = redactHeaders({ 'Set-Cookie': 'token=xyz; Path=/' })
    expect(result['Set-Cookie']).toBe('[REDACTED]')
  })

  it('redacts X-Api-Key header', () => {
    const result = redactHeaders({ 'X-Api-Key': 'sk-123456' })
    expect(result['X-Api-Key']).toBe('[REDACTED]')
  })

  it('redacts X-Auth-Token header', () => {
    const result = redactHeaders({ 'X-Auth-Token': 'my-secret-token' })
    expect(result['X-Auth-Token']).toBe('[REDACTED]')
  })

  it('redacts Proxy-Authorization header', () => {
    const result = redactHeaders({ 'Proxy-Authorization': 'Basic abc' })
    expect(result['Proxy-Authorization']).toBe('[REDACTED]')
  })

  it('matches headers case-insensitively', () => {
    const headers = {
      'authorization': 'Bearer token',
      'AUTHORIZATION': 'Bearer token2',
      'x-api-key': 'key123',
      'X-API-KEY': 'key456',
    }
    const result = redactHeaders(headers)
    expect(result['authorization']).toBe('[REDACTED]')
    expect(result['AUTHORIZATION']).toBe('[REDACTED]')
    expect(result['x-api-key']).toBe('[REDACTED]')
    expect(result['X-API-KEY']).toBe('[REDACTED]')
  })

  it('passes through non-credential headers unchanged', () => {
    const headers = {
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US',
      'X-Request-Id': 'abc-123',
    }
    const result = redactHeaders(headers)
    expect(result).toEqual(headers)
  })

  it('skips redaction when fullHeaders is true', () => {
    const headers = { Authorization: 'Bearer secret', 'Content-Type': 'text/plain' }
    const result = redactHeaders(headers, { fullHeaders: true })
    expect(result['Authorization']).toBe('Bearer secret')
    expect(result['Content-Type']).toBe('text/plain')
  })

  it('returns a new object (does not mutate input)', () => {
    const headers = { Authorization: 'secret' }
    const result = redactHeaders(headers)
    expect(result).not.toBe(headers)
    expect(headers['Authorization']).toBe('secret')
  })
})

describe('redactBody', () => {
  // --- String body tests ---

  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const body = `{"token": "${jwt}"}`
    const result = redactBody(body) as string
    expect(result).not.toContain('eyJ')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts unsigned JWTs (empty signature)', () => {
    const unsignedJwt = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.'
    const result = redactBody(unsignedJwt) as string
    expect(result).not.toContain('eyJ')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts OpenAI-style sk- keys', () => {
    const body = '{"api_key": "sk-abc123def456ghi789jkl012mno345"}'
    const result = redactBody(body) as string
    expect(result).not.toContain('sk-abc')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Stripe live keys', () => {
    const body = 'key is sk_live_abcdefghijklmnopqrstuv'
    const result = redactBody(body) as string
    expect(result).not.toContain('sk_live_')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts key_ prefixed tokens', () => {
    const body = 'key_abcdefghijklmnop1234'
    const result = redactBody(body) as string
    expect(result).not.toContain('key_')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts token_ prefixed tokens', () => {
    const body = 'token_abcdefghijklmnop1234'
    const result = redactBody(body) as string
    expect(result).not.toContain('token_')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts AWS access key IDs', () => {
    const body = '{"aws_key": "AKIAIOSFODNN7EXAMPLE"}'
    const result = redactBody(body) as string
    expect(result).not.toContain('AKIA')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Bearer tokens in body text', () => {
    const body = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890'
    const result = redactBody(body) as string
    expect(result).not.toContain('abcdefghijklmnopqrst')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Bearer tokens with special characters (colons, percent-encoding)', () => {
    const body = 'Bearer abc:def%20ghijklmnopqrstuv1234567890'
    const result = redactBody(body) as string
    // Should not leak suffix after colon
    expect(result).not.toContain('def%20')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts GitHub PATs (ghp_)', () => {
    const body = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
    const result = redactBody(body) as string
    expect(result).not.toContain('ghp_')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Slack tokens (xoxb-)', () => {
    const body = 'slack_token=xoxb-123456789-abcdefghij'
    const result = redactBody(body) as string
    expect(result).not.toContain('xoxb-')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts npm tokens', () => {
    const body = 'npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
    const result = redactBody(body) as string
    expect(result).not.toContain('npm_')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Google API keys', () => {
    // AIzaSy + exactly 33 chars = 39 total
    const body = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456'
    const result = redactBody(body) as string
    expect(result).not.toContain('AIzaSy')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts multiple credential patterns in one body', () => {
    const body = 'jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U key=sk-abc123def456ghi789jkl012mno345'
    const result = redactBody(body) as string
    expect(result).not.toContain('eyJ')
    expect(result).not.toContain('sk-abc')
    expect(result.match(/\[REDACTED\]/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('does not redact short strings that look like partial keys', () => {
    const body = 'sk-short1234'
    const result = redactBody(body) as string
    expect(result).toBe('sk-short1234')
  })

  it('preserves non-credential body content', () => {
    const body = '{"name": "Alice", "email": "alice@example.com", "count": 42}'
    const result = redactBody(body) as string
    expect(result).toBe(body)
  })

  // --- Object body tests (Fix 1: credential in nested objects) ---

  it('redacts credentials inside object bodies', () => {
    const body = { api_key: 'sk-abc123def456ghi789jkl012mno345', name: 'safe' }
    const result = redactBody(body) as Record<string, unknown>
    expect(result['api_key']).toContain('[REDACTED]')
    expect(result['name']).toBe('safe')
  })

  it('redacts credentials in nested object bodies', () => {
    const body = { config: { token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' }, safe: true }
    const result = redactBody(body) as Record<string, unknown>
    const config = result['config'] as Record<string, unknown>
    expect(config['token']).toContain('[REDACTED]')
    expect(result['safe']).toBe(true)
  })

  it('redacts credentials in array bodies', () => {
    const body = ['sk-abc123def456ghi789jkl012mno345', 'safe-value']
    const result = redactBody(body) as string[]
    expect(result[0]).toContain('[REDACTED]')
    expect(result[1]).toBe('safe-value')
  })

  it('returns safe object bodies unchanged (by reference)', () => {
    const body = { name: 'Alice', count: 42 }
    const result = redactBody(body)
    // No redaction needed — should return original object
    expect(result).toBe(body)
  })

  // --- Primitive/null body tests ---

  it('returns null/undefined/number bodies unchanged', () => {
    expect(redactBody(null)).toBeNull()
    expect(redactBody(undefined)).toBeUndefined()
    expect(redactBody(42)).toBe(42)
  })
})

describe('redactWireEntry', () => {
  it('redacts all credential-bearing fields in a wire entry', () => {
    const entry = {
      id: 'test-1',
      request_headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      request_body: '{"token": "sk-abcdefghijklmnopqrstuvwxyz1234"}',
      response_headers: { 'Set-Cookie': 'session=abc', 'Content-Type': 'application/json' },
      response_body: '{"data": "safe content"}',
    }

    const result = redactWireEntry(entry)

    expect(result.id).toBe('test-1')
    expect(result.request_headers['Authorization']).toBe('[REDACTED]')
    expect(result.request_headers['Content-Type']).toBe('application/json')
    expect(result.request_body).toContain('[REDACTED]')
    expect(result.response_headers['Set-Cookie']).toBe('[REDACTED]')
    expect(result.response_headers['Content-Type']).toBe('application/json')
    expect(result.response_body).toBe('{"data": "safe content"}')
  })

  it('redacts credentials in object request/response bodies', () => {
    const entry = {
      request_headers: {},
      request_body: { password: 'sk-abc123def456ghi789jkl012mno345' },
      response_headers: {},
      response_body: { token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' },
    }

    const result = redactWireEntry(entry)
    expect((result.request_body as Record<string, unknown>)['password']).toContain('[REDACTED]')
    expect((result.response_body as Record<string, unknown>)['token']).toContain('[REDACTED]')
  })

  it('handles null/undefined headers defensively', () => {
    const entry = {
      request_headers: undefined as unknown as Record<string, string>,
      request_body: null,
      response_headers: null as unknown as Record<string, string>,
      response_body: null,
    }

    // Should not throw
    const result = redactWireEntry(entry)
    expect(result.request_headers).toEqual({})
    expect(result.response_headers).toEqual({})
  })

  it('respects fullHeaders option', () => {
    const entry = {
      request_headers: { Authorization: 'Bearer secret' },
      request_body: null,
      response_headers: { 'Set-Cookie': 'session=abc' },
      response_body: null,
    }

    const result = redactWireEntry(entry, { fullHeaders: true })
    expect(result.request_headers['Authorization']).toBe('Bearer secret')
    expect(result.response_headers['Set-Cookie']).toBe('session=abc')
  })

  it('does not mutate the original entry', () => {
    const entry = {
      request_headers: { Authorization: 'Bearer secret' },
      request_body: null,
      response_headers: {},
      response_body: null,
    }

    redactWireEntry(entry)
    expect(entry.request_headers['Authorization']).toBe('Bearer secret')
  })
})
