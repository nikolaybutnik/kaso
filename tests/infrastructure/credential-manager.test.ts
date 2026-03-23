/**
 * Tests for credential manager
 * Tests Property 37: Credentials loaded only from secure sources
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { CredentialManager } from '../../src/infrastructure/credential-manager.js'
import keytar from 'keytar'

// Spy on keytar methods
const getPasswordSpy = vi.spyOn(keytar, 'getPassword')

describe('CredentialManager', () => {
  let credentialManager: CredentialManager
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Create fresh instance for each test
    credentialManager = new CredentialManager({ serviceName: 'kaso-test' })

    // Clear cache
    credentialManager.clearCache()

    // Reset spies
    getPasswordSpy.mockReset()

    // Reset env
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  describe('getApiKey', () => {
    it('should load key from environment variable first', async () => {
      process.env.TEST_API_KEY = 'env-secret-value'

      const key = await credentialManager.getApiKey('TEST_API_KEY')

      expect(key).toBe('env-secret-value')
      expect(getPasswordSpy).not.toHaveBeenCalled()
    })

    it('should fallback to keychain if not in environment', async () => {
      delete process.env.TEST_API_KEY
      getPasswordSpy.mockResolvedValue('keychain-secret-value')

      const key = await credentialManager.getApiKey('TEST_API_KEY')

      expect(key).toBe('keychain-secret-value')
      expect(getPasswordSpy).toHaveBeenCalledWith('kaso-test', 'TEST_API_KEY')
    })

    it('should cache loaded secrets', async () => {
      process.env.TEST_API_KEY = 'secret-value'

      // Load once
      await credentialManager.getApiKey('TEST_API_KEY')

      // Load again (should use cache)
      await credentialManager.getApiKey('TEST_API_KEY')

      expect(getPasswordSpy).not.toHaveBeenCalled()
    })

    it('should throw descriptive error if key not found', async () => {
      delete process.env.TEST_API_KEY
      getPasswordSpy.mockResolvedValue(null)

      await expect(credentialManager.getApiKey('TEST_API_KEY')).rejects.toThrow(
        'API key "TEST_API_KEY" not found',
      )
    })

    it('should throw error if keychain access fails', async () => {
      delete process.env.TEST_API_KEY
      getPasswordSpy.mockRejectedValue(new Error('Keychain locked'))

      await expect(credentialManager.getApiKey('TEST_API_KEY')).rejects.toThrow(
        'Failed to access OS keychain',
      )
    })
  })

  describe('listRequiredKeys', () => {
    it('should return empty array by default', () => {
      expect(credentialManager.listRequiredKeys()).toEqual([])
    })

    it('should return configured required keys', () => {
      credentialManager.setRequiredKeys(['KEY1', 'KEY2', 'KEY3'])

      expect(credentialManager.listRequiredKeys()).toEqual([
        'KEY1',
        'KEY2',
        'KEY3',
      ])
    })
  })

  describe('validateAllPresent', () => {
    beforeEach(() => {
      credentialManager.setRequiredKeys(['KEY1', 'KEY2'])
    })

    it('should return true if all required keys are present', async () => {
      process.env.KEY1 = 'value1'
      process.env.KEY2 = 'value2'

      await expect(credentialManager.validateAllPresent()).resolves.toBe(true)
    })

    it('should throw error if any required key is missing', async () => {
      process.env.KEY1 = 'value1'
      // KEY2 not set

      await expect(credentialManager.validateAllPresent()).rejects.toThrow(
        'Missing required API keys: KEY2',
      )
    })

    it('should list all missing keys in error', async () => {
      // Neither KEY1 nor KEY2 are set

      await expect(credentialManager.validateAllPresent()).rejects.toThrow(
        'Missing required API keys: KEY1, KEY2',
      )
    })
  })

  describe('redact', () => {
    beforeEach(() => {
      // Load some secrets
      process.env.API_KEY_1 = 'secret-key-abc-123'
      process.env.API_KEY_2 = 'another-secret-key-xyz-456'
      process.env.SHORT_KEY = 'key'
    })

    it('should redact secrets from text', async () => {
      await credentialManager.getApiKey('API_KEY_1')
      await credentialManager.getApiKey('API_KEY_2')

      const text =
        'Error: failed to authenticate with secret-key-abc-123 and another-secret-key-xyz-456'
      const redacted = credentialManager.redact(text)

      expect(redacted).toBe(
        'Error: failed to authenticate with [REDACTED] and [REDACTED]',
      )
      expect(redacted).not.toContain('secret-key-abc-123')
      expect(redacted).not.toContain('another-secret-key-xyz-456')
    })

    it('should handle text without secrets', async () => {
      await credentialManager.getApiKey('API_KEY_1')

      const text = 'This is a normal log message without secrets'
      const redacted = credentialManager.redact(text)

      expect(redacted).toBe('This is a normal log message without secrets')
    })

    it('should handle empty or null text', async () => {
      await credentialManager.getApiKey('API_KEY_1')

      expect(credentialManager.redact('')).toBe('')
      expect(credentialManager.redact(null as any)).toBe(null)
    })

    it('should redact longest secrets first to avoid partial matches', async () => {
      // Short key is a substring of the longer key
      await credentialManager.getApiKey('API_KEY_1')
      await credentialManager.getApiKey('SHORT_KEY')

      const text = 'Using secret-key-abc-123'
      const redacted = credentialManager.redact(text)

      // Should redact the full secret, not leave "-abc-123"
      expect(redacted).toBe('Using [REDACTED]')
      expect(redacted).not.toContain('-abc-123')
    })

    it('should handle special regex characters in secrets', async () => {
      process.env.REGEX_KEY = 'key.with.dots+and$special*chars'
      await credentialManager.getApiKey('REGEX_KEY')

      const text = 'Key: key.with.dots+and$special*chars'
      const redacted = credentialManager.redact(text)

      expect(redacted).toBe('Key: [REDACTED]')
    })
  })

  describe('getAllSecrets', () => {
    it('should return all loaded secrets', async () => {
      process.env.KEY1 = 'secret1'
      process.env.KEY2 = 'secret2'

      await credentialManager.getApiKey('KEY1')
      await credentialManager.getApiKey('KEY2')

      const secrets = credentialManager.getAllSecrets()

      expect(secrets.size).toBe(2)
      expect(secrets.has('secret1')).toBe(true)
      expect(secrets.has('secret2')).toBe(true)
    })

    it('should return empty set if no secrets loaded', () => {
      expect(credentialManager.getAllSecrets().size).toBe(0)
    })
  })

  describe('clearCache', () => {
    it('should clear all cached secrets', async () => {
      process.env.KEY1 = 'secret1'
      await credentialManager.getApiKey('KEY1')

      expect(credentialManager.hasKey('KEY1')).toBe(true)

      credentialManager.clearCache()

      expect(credentialManager.hasKey('KEY1')).toBe(false)
      expect(credentialManager.getAllSecrets().size).toBe(0)
    })
  })

  describe('hasKey and deleteKey', () => {
    it('should check if key is loaded', async () => {
      process.env.KEY1 = 'secret1'

      expect(credentialManager.hasKey('KEY1')).toBe(false)

      await credentialManager.getApiKey('KEY1')

      expect(credentialManager.hasKey('KEY1')).toBe(true)
    })

    it('should delete specific key from cache', async () => {
      process.env.KEY1 = 'secret1'
      process.env.KEY2 = 'secret2'

      await credentialManager.getApiKey('KEY1')
      await credentialManager.getApiKey('KEY2')

      credentialManager.deleteKey('KEY1')

      expect(credentialManager.hasKey('KEY1')).toBe(false)
      expect(credentialManager.hasKey('KEY2')).toBe(true)
    })
  })
})

describe('Property 37: Credentials loaded only from secure sources', () => {
  it('should never read credentials from files', () => {
    // This is a design-level test to ensure credentials are only loaded from env/keychain
    const credentialManager = new CredentialManager()

    // The credential manager should not have any file reading logic
    expect(credentialManager.getApiKey.toString()).not.toContain('readFile')
    expect(credentialManager.getApiKey.toString()).not.toContain('readFileSync')
    expect(credentialManager.getApiKey.toString()).not.toContain('fs.')
  })

  it('should prefer environment variables over keychain', async () => {
    const credentialManager = new CredentialManager()
    process.env.TEST_KEY = 'env-value'

    getPasswordSpy.mockResolvedValue('keychain-value')

    const key = await credentialManager.getApiKey('TEST_KEY')

    expect(key).toBe('env-value')
    expect(getPasswordSpy).not.toHaveBeenCalled()
  })
})
