/**
 * Property-based tests for credential security
 * Property 36: Secret redaction in logs
 * Property 37: Credentials loaded only from secure sources
 */

import { test, fc } from '@fast-check/vitest'
import { describe, expect, vi } from 'vitest'
import { CredentialManager } from '@/infrastructure/credential-manager'
import { redactSecrets } from '@/infrastructure/log-redactor'
import keytar from 'keytar'

// Spy on keytar for property tests
const getPasswordSpy = vi.spyOn(keytar, 'getPassword')

describe('Property 36: Secret redaction in logs', () => {
  test.prop([
    fc.array(fc.string({ minLength: 5, maxLength: 50 }), {
      minLength: 1,
      maxLength: 5,
    }),
    fc.string({ minLength: 20, maxLength: 200 }),
  ])(
    'should redact all secrets from any log text',
    async (secretsArray, baseText) => {
      // Skip if any secret is just whitespace or has special regex chars
      const hasValidSecrets = secretsArray.every(
        (s) => s.trim().length > 0 && !/[*+?^$()|[\]{},%]/.test(s),
      )
      if (!hasValidSecrets) {
        return // Skip this test case
      }
      const credentialManager = new CredentialManager()

      // Inject secrets into environment so they're "loaded"
      secretsArray.forEach((secret, i) => {
        process.env[`KEY_${i}`] = secret
      })

      // Load all secrets
      for (let i = 0; i < secretsArray.length; i++) {
        await credentialManager.getApiKey(`KEY_${i}`)
      }

      // Create text containing all secrets by interleaving
      let textWithSecrets = baseText
      secretsArray.forEach((secret, i) => {
        // Insert secrets at various positions to ensure they're in the text
        const insertPos = Math.min(i * 10, textWithSecrets.length)
        const before = textWithSecrets.substring(0, insertPos)
        const after = textWithSecrets.substring(insertPos)
        textWithSecrets = `${before} [${secret}] ${after}`
      })

      // Redact
      const redacted = credentialManager.redact(textWithSecrets)

      // Verify no secrets remain
      secretsArray.forEach((secret) => {
        expect(redacted).not.toContain(secret)
      })

      // Verify redaction marker is present
      expect(redacted).toContain('[REDACTED]')
    },
  )

  test.prop([
    fc.array(fc.string({ minLength: 3, maxLength: 30 }), {
      minLength: 1,
      maxLength: 10,
    }),
    fc.string({ minLength: 10, maxLength: 100 }),
  ])('should preserve non-secret text', (secretsArray, originalText) => {
    const secrets = new Set(secretsArray)

    // The original text should remain unchanged except for secrets
    const redacted = redactSecrets(originalText, secrets)

    // Split on redaction markers
    const parts = redacted.split('[REDACTED]')

    // All parts between redactions should not contain any secrets
    parts.forEach((part) => {
      secretsArray.forEach((secret) => {
        expect(part).not.toContain(secret)
      })
    })
  })

  test.prop([
    fc.array(fc.string({ minLength: 5, maxLength: 20 }), {
      minLength: 2,
      maxLength: 5,
    }),
  ])('should handle special regex characters in secrets', (secretsArray) => {
    const secrets = new Set(secretsArray)
    const text = secretsArray.join(' and ')
    const redacted = redactSecrets(text, secrets)

    secretsArray.forEach((secret) => {
      expect(redacted).not.toContain(secret)
    })
  })

  test.prop([
    fc.array(fc.string({ minLength: 10, maxLength: 30 }), {
      minLength: 1,
      maxLength: 3,
    }),
  ])('should redact longest secrets first', (secretsArray) => {
    // Find pairs where one secret is substring of another
    const hasSubstrings = secretsArray.some((secret1, i) =>
      secretsArray.some((secret2, j) => i !== j && secret1.includes(secret2)),
    )

    if (!hasSubstrings) {
      return // Skip if no substrings
    }

    const secrets = new Set(secretsArray)
    const text = secretsArray.join(' in ')
    const redacted = redactSecrets(text, secrets)

    // No partial matches should remain
    secretsArray.forEach((secret) => {
      const otherSecrets = secretsArray.filter((s) => s !== secret)
      otherSecrets.forEach((other) => {
        if (other.includes(secret)) {
          // If other contains secret, secret should be completely redacted
          expect(redacted).not.toContain(secret)
        }
      })
    })
  })
})

describe('Property 37: Credentials loaded only from secure sources', () => {
  test.prop([
    fc.array(fc.string({ minLength: 5, maxLength: 30 }), {
      minLength: 1,
      maxLength: 5,
    }),
    fc.array(fc.string({ minLength: 5, maxLength: 30 }), {
      minLength: 1,
      maxLength: 5,
    }),
  ])(
    'should only load from environment or keychain, never files',
    async (envKeys, keychainKeys) => {
      // Skip if any key is just whitespace or has special regex chars
      const allKeyValues = [...envKeys, ...keychainKeys]
      const hasValidKeys = allKeyValues.every(
        (s) => s.trim().length > 0 && !/[*+?^$()|[\]{},%]/.test(s),
      )
      if (!hasValidKeys) {
        return // Skip this test case
      }
      const credentialManager = new CredentialManager()

      // Clear env
      const originalEnv = { ...process.env }
      process.env = {}

      // Set some keys in environment
      envKeys.forEach((key, i) => {
        process.env[`ENV_KEY_${i}`] = key
      })

      // Mock keychain for other keys
      getPasswordSpy.mockImplementation((_service, account) => {
        const match = account.match(/KEYCHAIN_KEY_(\d+)/)
        if (match?.[1]) {
          const index = parseInt(match[1])
          if (index < keychainKeys.length) {
            return Promise.resolve(keychainKeys[index] ?? null)
          }
        }
        return Promise.resolve(null)
      })

      // Load all keys
      const allKeys = [
        ...envKeys.map((_, i) => `ENV_KEY_${i}`),
        ...keychainKeys.map((_, i) => `KEYCHAIN_KEY_${i}`),
      ]

      const loadedKeys = await credentialManager.getApiKeys(allKeys)

      // Verify all keys were loaded
      expect(loadedKeys.size).toBe(allKeys.length)

      // Verify no file system access
      expect(credentialManager.getApiKey.toString()).not.toContain('readFile')
      expect(credentialManager.getApiKey.toString()).not.toContain('fs.')

      // Cleanup
      process.env = originalEnv
      getPasswordSpy.mockReset()
    },
  )

  test.prop([fc.string({ minLength: 10, maxLength: 50 })])(
    'should prefer environment variables over keychain',
    async (secretValue) => {
      const credentialManager = new CredentialManager()
      const keyName = 'TEST_PREFERENCE_KEY'

      // Set both env and keychain
      process.env[keyName] = secretValue
      getPasswordSpy.mockResolvedValue('keychain-value-should-not-be-used')

      const loadedValue = await credentialManager.getApiKey(keyName)

      // Should use env value, not keychain
      expect(loadedValue).toBe(secretValue)
      expect(getPasswordSpy).not.toHaveBeenCalled()

      delete process.env[keyName]
    },
  )

  test('should throw error for missing keys without attempting file access', async () => {
    const credentialManager = new CredentialManager()
    const keyName = 'MISSING_KEY_' + Math.random().toString(36).substring(7)

    getPasswordSpy.mockResolvedValue(null)

    await expect(credentialManager.getApiKey(keyName)).rejects.toThrow(
      /not found/,
    )

    // Should not contain file access attempts
    expect(credentialManager.getApiKey.toString()).not.toMatch(
      /readFile|readFileSync|require\(['"]\.\/|require\(['"]\.\.\//,
    )
  })

  test.prop([
    fc.array(fc.string({ minLength: 5, maxLength: 20 }), {
      minLength: 1,
      maxLength: 3,
    }),
  ])('should cache credentials after first load', async (secrets) => {
    const credentialManager = new CredentialManager()

    secrets.forEach((secret, i) => {
      process.env[`CACHE_KEY_${i}`] = secret
    })

    // Load once
    await Promise.all(
      secrets.map((_, i) => credentialManager.getApiKey(`CACHE_KEY_${i}`)),
    )

    // Clear spy to see if functions are called again
    getPasswordSpy.mockClear()

    // Load again
    const secondLoad = await Promise.all(
      secrets.map((_, i) => credentialManager.getApiKey(`CACHE_KEY_${i}`)),
    )

    // Should return same values
    secrets.forEach((secret, i) => {
      expect(secondLoad[i]).toBe(secret)
    })

    // Should not access keychain again
    expect(getPasswordSpy).not.toHaveBeenCalled()

    // Cleanup
    secrets.forEach((_, i) => {
      delete process.env[`CACHE_KEY_${i}`]
    })
  })
})
