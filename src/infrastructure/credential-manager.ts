/**
 * Credential manager for KASO
 * Loads API keys from environment variables or OS keychain
 * Never reads from git-tracked files
 */

import keytar from 'keytar'
import { redactSecrets } from './log-redactor'

/**
 * Credential manager options
 */
export interface CredentialManagerOptions {
  serviceName?: string
  requiredKeys?: string[]
}

/**
 * Credential manager class
 * Manages API keys and secrets with secure loading and redaction
 */
export class CredentialManager {
  private readonly serviceName: string
  private readonly requiredKeys: string[]
  private readonly loadedSecrets: Map<string, string> = new Map()
  private readonly secretsSet: Set<string> = new Set()

  /**
   * Create a new credential manager
   * @param options - Configuration options
   */
  constructor(options: CredentialManagerOptions = {}) {
    this.serviceName = options.serviceName || 'kaso'
    this.requiredKeys = options.requiredKeys || []
  }

  /**
   * Get a specific API key
   * Tries environment variable first, then OS keychain
   * @param keyName - Name of the API key (e.g., 'KIMI_API_KEY')
   * @returns The API key value
   * @throws Error if key is not found
   */
  async getApiKey(keyName: string): Promise<string> {
    // Check cache first
    if (this.loadedSecrets.has(keyName)) {
      return this.loadedSecrets.get(keyName)!
    }

    // Try environment variable first
    const envValue = process.env[keyName]
    if (envValue) {
      this.loadedSecrets.set(keyName, envValue)
      this.secretsSet.add(envValue)
      return envValue
    }

    // Fall back to OS keychain
    try {
      const keychainValue = await keytar.getPassword(this.serviceName, keyName)
      if (keychainValue) {
        this.loadedSecrets.set(keyName, keychainValue)
        this.secretsSet.add(keychainValue)
        return keychainValue
      }
    } catch (error) {
      // Keychain access failed, continue to throw error below
      throw new Error(
        `Failed to access OS keychain for key "${keyName}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Key not found anywhere
    throw new Error(
      `API key "${keyName}" not found. Please set the ${keyName} environment variable or add it to your OS keychain using: keytar setPassword "${this.serviceName}" "${keyName}" <your-key>`,
    )
  }

  /**
   * Get multiple API keys at once
   * @param keyNames - Array of key names
   * @returns Map of key names to values
   */
  async getApiKeys(keyNames: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>()

    for (const keyName of keyNames) {
      const value = await this.getApiKey(keyName)
      results.set(keyName, value)
    }

    return results
  }

  /**
   * List all required credential keys
   * @returns Array of required key names
   */
  listRequiredKeys(): string[] {
    return [...this.requiredKeys]
  }

  /**
   * Set the required keys list
   * @param keys - Array of required key names
   */
  setRequiredKeys(keys: string[]): void {
    this.requiredKeys.length = 0
    this.requiredKeys.push(...keys)
  }

  /**
   * Validate that all required keys are present
   * @returns True if all required keys are available
   * @throws Error listing all missing keys if any are missing
   */
  async validateAllPresent(): Promise<boolean> {
    const missingKeys: string[] = []

    for (const keyName of this.requiredKeys) {
      try {
        await this.getApiKey(keyName)
      } catch (error) {
        missingKeys.push(keyName)
      }
    }

    if (missingKeys.length > 0) {
      throw new Error(
        `Missing required API keys: ${missingKeys.join(', ')}. ` +
          `Please set these as environment variables or in your OS keychain.`,
      )
    }

    return true
  }

  /**
   * Redact all known secrets from text
   * @param text - Text to redact secrets from
   * @returns Text with secrets replaced with [REDACTED]
   */
  redact(text: string): string {
    if (!text || this.secretsSet.size === 0) {
      return text
    }

    return redactSecrets(text, this.secretsSet)
  }

  /**
   * Get all loaded secret values for redaction
   * @returns Set of all secret values
   */
  getAllSecrets(): Set<string> {
    return new Set(this.secretsSet)
  }

  /**
   * Clear all cached secrets
   * Useful for testing or when rotating credentials
   */
  clearCache(): void {
    this.loadedSecrets.clear()
    this.secretsSet.clear()
  }

  /**
   * Check if a specific key is loaded
   * @param keyName - Name of the key to check
   * @returns True if the key is loaded
   */
  hasKey(keyName: string): boolean {
    return this.loadedSecrets.has(keyName)
  }

  /**
   * Delete a specific key from cache
   * @param keyName - Name of the key to delete
   */
  deleteKey(keyName: string): void {
    const value = this.loadedSecrets.get(keyName)
    if (value) {
      this.loadedSecrets.delete(keyName)
      this.secretsSet.delete(value)
    }
  }
}

export default CredentialManager
