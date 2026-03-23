/**
 * Tests for log redactor
 * Tests Property 36: Secret redaction in logs
 */

import { describe, expect, it } from 'vitest'
import {
  redactSecrets,
  redactMultiple,
  redactObject,
  redactError,
} from '../../src/infrastructure/log-redactor'

describe('redactSecrets', () => {
  it('should redact secrets from text', () => {
    const secrets = new Set(['secret-key-123', 'password456'])
    const text =
      'Error: failed to authenticate with secret-key-123 and password456'

    const result = redactSecrets(text, secrets)

    expect(result).toBe(
      'Error: failed to authenticate with [REDACTED] and [REDACTED]',
    )
    expect(result).not.toContain('secret-key-123')
    expect(result).not.toContain('password456')
  })

  it('should handle text without secrets', () => {
    const secrets = new Set(['secret-key-123'])
    const text = 'This is a normal log message without secrets'

    const result = redactSecrets(text, secrets)

    expect(result).toBe(text)
  })

  it('should handle empty or null text', () => {
    const secrets = new Set(['secret'])

    expect(redactSecrets('', secrets)).toBe('')
    expect(redactSecrets(null as any, secrets)).toBe(null)
  })

  it('should handle empty secrets set', () => {
    const text = 'Text with secret-value'
    const result = redactSecrets(text, new Set())

    expect(result).toBe(text)
  })

  it('should redact longest secrets first to avoid partial matches', () => {
    const secrets = new Set(['secret-key-abc-123', 'key-abc'])
    const text = 'Error: failed with secret-key-abc-123'

    const result = redactSecrets(text, secrets)

    expect(result).toBe('Error: failed with [REDACTED]')
    // Should not leave partial matches like "secret-[REDACTED]-123"
    expect(result).not.toContain('-123')
  })

  it('should redact all occurrences of each secret', () => {
    const secrets = new Set(['secret-key'])
    const text = 'Key 1: secret-key, Key 2: secret-key, Key 3: secret-key'

    const result = redactSecrets(text, secrets)

    expect(result).toBe(
      'Key 1: [REDACTED], Key 2: [REDACTED], Key 3: [REDACTED]',
    )
    expect(result.split('[REDACTED]').length - 1).toBe(3)
  })

  it('should handle special regex characters in secrets', () => {
    const secrets = new Set([
      'key.with.dots',
      'key$with$dollar',
      'key*with*star',
      'key+with+plus',
      'key(with(parens)',
      'key[with]brackets',
    ])

    secrets.forEach((secret) => {
      const text = `Using ${secret} for auth`
      const result = redactSecrets(text, secrets)
      expect(result).toBe('Using [REDACTED] for auth')
    })
  })

  it('should redact API keys that look like real keys', () => {
    const secrets = new Set([
      'sk-ant-api03-very-long-key-with-many-characters-123456789',
      'xai-very-long-key-with-dashes-and-numbers-0987654321',
      'simple-key-no-special-chars',
    ])

    const text =
      'Authenticating with sk-ant-api03-very-long-key-with-many-characters-123456789 and xai-very-long-key-with-dashes-and-numbers-0987654321'

    const result = redactSecrets(text, secrets)

    expect(result).toBe('Authenticating with [REDACTED] and [REDACTED]')
  })

  it('should handle secrets with whitespace correctly', () => {
    const secrets = new Set([' secret ', 'another'])
    const text = 'Using secret with spaces: secret and another'

    const result = redactSecrets(text, secrets)

    // Should redact the whitespace-padded secret and exact match 'another'
    // Note: The space before 'secret' from ' secret ' is matched and replaced
    expect(result).toBe('Using[REDACTED]with spaces:[REDACTED]and [REDACTED]')
    expect(result).not.toContain(' secret ') // original with spaces
    expect(result).toContain('with spaces') // remaining text
  })
})

describe('redactMultiple', () => {
  it('should redact secrets from multiple text sources', () => {
    const secrets = new Set(['secret1', 'secret2'])
    const sources = [
      'Error with secret1 in source 1',
      'Warning with secret2 in source 2',
      'Info without secrets',
    ]

    const results = redactMultiple(sources, secrets)

    expect(results[0]).toBe('Error with [REDACTED] in source 1')
    expect(results[1]).toBe('Warning with [REDACTED] in source 2')
    expect(results[2]).toBe('Info without secrets')
  })

  it('should handle empty sources array', () => {
    const results = redactMultiple([], new Set(['secret']))
    expect(results).toEqual([])
  })
})

describe('redactObject', () => {
  it('should redact secrets from object', () => {
    const secrets = new Set(['secret-key'])
    const obj = {
      message: 'Error occurred',
      details: {
        auth: 'Used secret-key for authentication',
        code: 500,
      },
    }

    const result = redactObject(obj, secrets)

    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('secret-key')
    expect(result).toContain('Error occurred')
    expect(result).toContain('500')
  })

  it('should handle strings as objects', () => {
    const secrets = new Set(['secret'])
    const result = redactObject('String with secret', secrets)

    expect(result).toBe('"String with [REDACTED]"')
  })

  it('should handle null and undefined', () => {
    const secrets = new Set(['secret'])

    // Nullish values are returned as-is for consistency with redactSecrets()
    expect(redactObject(null, secrets)).toBe(null)
    expect(redactObject(undefined, secrets)).toBe(undefined)
  })

  it('should handle circular references gracefully', () => {
    const secrets = new Set(['secret'])
    const obj: any = { name: 'test' }
    obj.self = obj // Create circular reference

    // Should not throw, falls back to String()
    const result = redactObject(obj, secrets)
    expect(typeof result).toBe('string')
  })
})

describe('redactError', () => {
  it('should redact secrets from error message and stack', () => {
    const secrets = new Set(['secret-key', 'password'])
    const error = new Error(
      'Authentication failed with secret-key and password',
    )

    const result = redactError(error, secrets)

    expect(result.message).toBe(
      'Authentication failed with [REDACTED] and [REDACTED]',
    )
    expect(result.stack).toBeDefined()
    expect(result.stack).toContain('[REDACTED]')
    expect(result.stack).not.toContain('secret-key')
    expect(result.stack).not.toContain('password')
  })

  it('should handle errors without stack traces', () => {
    const secrets = new Set(['secret'])
    const error = new Error('Simple error')
    delete (error as any).stack

    const result = redactError(error, secrets)

    expect(result.message).toBe('Simple error')
    expect(result.stack).toBeUndefined()
  })
})

describe('Property 36: Secret redaction in logs', () => {
  it('should redact all secrets without exception', () => {
    const secrets = new Set(['secret1', 'secret2', 'secret3'])
    const logMessage =
      'Processing with secret1, secret2, and secret3 for operation'

    const result = redactSecrets(logMessage, secrets)

    // Verify no secrets remain
    secrets.forEach((secret) => {
      expect(result).not.toContain(secret)
    })

    expect(result).toContain('[REDACTED]')
  })

  it('should preserve non-secret text', () => {
    const secrets = new Set(['secret'])
    const logMessage = 'Processing: step1, step2, step3'

    const result = redactSecrets(logMessage, secrets)

    expect(result).toBe(logMessage)
    expect(result).toContain('step1')
    expect(result).toContain('step2')
    expect(result).toContain('step3')
  })
})
