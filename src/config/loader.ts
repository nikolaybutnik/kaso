/**
 * Configuration loader for KASO
 * Loads and validates config from JSON file with sensible defaults
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { validateConfig, getDefaultConfig, isValidConfig } from './schema'
import type { KASOConfig } from './schema'

/**
 * Configuration loader options
 */
export interface ConfigLoaderOptions {
  configPath?: string
  useDefaults?: boolean
}

/**
 * Load configuration from JSON file
 * @param options - Loader options
 * @returns Validated configuration object
 */
export function loadConfig(options: ConfigLoaderOptions = {}): KASOConfig {
  const {
    configPath = resolve(process.cwd(), 'kaso.config.json'),
    useDefaults = true,
  } = options

  try {
    // Read and parse the config file
    const configContent = readFileSync(configPath, 'utf-8')
    const configData = JSON.parse(configContent)

    // If using defaults, merge with default config
    const config = useDefaults ? mergeWithDefaults(configData) : configData

    // Validate the config
    return validateConfig(config)
  } catch (error) {
    // If file not found and defaults are enabled, return defaults
    if (
      useDefaults &&
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      console.warn(`Config file not found at ${configPath}, using defaults`)
      return getDefaultConfig()
    }
    handleConfigLoadError(error, configPath, useDefaults)
  }
}

/**
 * Load configuration from JSON file (safe version that returns defaults on failure)
 * @param options - Loader options
 * @returns Validated configuration object or defaults if loading fails
 */
export function loadConfigSafe(options: ConfigLoaderOptions = {}): KASOConfig {
  try {
    return loadConfig(options)
  } catch (error) {
    console.warn(
      `Failed to load config, using defaults: ${(error as Error).message}`,
    )
    return getDefaultConfig()
  }
}

/**
 * Merge config data with default values
 * @param configData - User-provided config data
 * @returns Merged config with defaults
 */
function mergeWithDefaults(configData: unknown): unknown {
  const defaults = getDefaultConfig()

  if (typeof configData !== 'object' || configData === null) {
    return defaults
  }

  // Deep merge implementation
  return deepMerge({}, defaults, configData as Record<string, unknown>)
}

/**
 * Deep merge helper
 * @param target - Target object
 * @param sources - Source objects to merge
 * @returns Merged object
 */
function deepMerge(
  target: Record<string, unknown>,
  ...sources: (Record<string, unknown> | undefined)[]
): Record<string, unknown> {
  for (const source of sources) {
    if (source === null || source === undefined) continue

    for (const [key, value] of Object.entries(source)) {
      if (value === null || value === undefined) continue

      if (Array.isArray(value)) {
        // For arrays, replace rather than concatenate
        // This ensures user config overrides defaults, not appends to them
        target[key] = [...value]
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        const targetObj = target[key]
        if (typeof targetObj === 'object' && targetObj !== null) {
          target[key] = deepMerge(
            {},
            targetObj as Record<string, unknown>,
            value as Record<string, unknown>,
          )
        } else {
          target[key] = deepMerge({}, value as Record<string, unknown>)
        }
      } else {
        target[key] = value
      }
    }
  }

  return target
}

/**
 * Load and validate a config file
 * @param configPath - Path to config file
 * @returns Validated config
 */
export function loadConfigFromFile(configPath: string): KASOConfig {
  return loadConfig({ configPath })
}

/**
 * Check if a config file exists and is valid
 * @param configPath - Path to config file
 * @returns True if valid, false otherwise
 */
export function checkConfigFile(
  configPath: string = resolve(process.cwd(), 'kaso.config.json'),
): boolean {
  try {
    const configContent = readFileSync(configPath, 'utf-8')
    const configData = JSON.parse(configContent)
    return isValidConfig(configData)
  } catch {
    return false
  }
}

/**
 * Get the config file path
 * @returns Resolved path to config file
 */
export function getConfigPath(): string {
  return resolve(process.cwd(), 'kaso.config.json')
}

/**
 * Handle config load error
 * @param error - The error that occurred
 * @param configPath - Path to config file
 * @param useDefaults - Whether defaults were being used
 */
function handleConfigLoadError(
  error: unknown,
  configPath: string,
  useDefaults: boolean,
): never {
  if (error instanceof SyntaxError) {
    throw new Error(
      `Invalid JSON in config file ${configPath}: ${error.message}`,
    )
  }

  if (error instanceof Error && error.message.includes('ENOENT')) {
    if (useDefaults) {
      // File doesn't exist but we're using defaults, return defaults
      console.warn(`Config file not found at ${configPath}, using defaults`)
      throw error
    }
    throw new Error(
      `Config file not found at ${configPath}. Create a kaso.config.json file or enable useDefaults.`,
    )
  }

  if (error instanceof Error && error.message.includes('validation')) {
    throw new Error(
      `Config validation failed for ${configPath}: ${error.message}`,
    )
  }

  throw new Error(
    `Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
  )
}
