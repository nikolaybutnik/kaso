/**
 * Log redactor for KASO
 * Redacts sensitive information from log output
 */

/**
 * Redact secrets from text
 * @param text - Text to redact secrets from
 * @param secrets - Set of secret strings to redact
 * @returns Text with secrets replaced with [REDACTED]
 */
export function redactSecrets(text: string, secrets: Set<string>): string {
  if (!text || secrets.size === 0) {
    return text
  }

  // Create a copy of the text to avoid mutating the original
  let redactedText = text

  // Sort secrets by length (longest first) to handle overlaps correctly
  // This prevents shorter secrets from interfering with longer ones
  const sortedSecrets = Array.from(secrets).sort((a, b) => {
    if (a.length !== b.length) {
      return b.length - a.length // Longest first
    }
    return a.localeCompare(b) // Stable sort for equal lengths
  })

  // Redact each secret
  for (const secret of sortedSecrets) {
    if (secret && secret.length > 0) {
      // Escape special regex characters in the secret
      const escapedSecret = escapeRegExp(secret)

      try {
        // Create a global regex to replace all occurrences
        const regex = new RegExp(escapedSecret, 'g')
        redactedText = redactedText.replace(regex, '[REDACTED]')
      } catch (error) {
        // If regex fails (invalid pattern), skip this secret
        console.warn(
          `Failed to create regex for secret: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  return redactedText
}

/**
 * Escape special regex characters in a string
 * @param str - String to escape
 * @returns Escaped string safe for use in RegExp
 */
function escapeRegExp(str: string): string {
  // Escape characters that have special meaning in regular expressions
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Redact multiple secrets from multiple text sources
 * @param sources - Array of text sources to redact
 * @param secrets - Set of secret strings to redact
 * @returns Array of redacted text sources
 */
export function redactMultiple(
  sources: string[],
  secrets: Set<string>,
): string[] {
  if (sources.length === 0 || secrets.size === 0) {
    return sources
  }

  return sources.map((source) => redactSecrets(source, secrets))
}

/**
 * Redact secrets from an object (stringifies and redacts)
 * Useful for redacting error objects or other data structures
 * @param obj - Object to redact
 * @param secrets - Set of secret strings to redact
 * @returns Redacted string representation, or null/undefined if obj is null/undefined
 * @note Nullish values (null/undefined) are returned as-is for consistency with redactSecrets()
 */
export function redactObject(
  obj: unknown,
  secrets: Set<string>,
): string | null | undefined {
  // Handle nullish values consistently with redactSecrets
  if (obj === null || obj === undefined) {
    return obj as string | null | undefined
  }

  try {
    // Try to JSON stringify first for best formatting
    const jsonString = JSON.stringify(obj, null, 2)
    return redactSecrets(jsonString, secrets)
  } catch {
    // If JSON fails, use toString
    const stringValue = String(obj)
    return redactSecrets(stringValue, secrets)
  }
}

/**
 * Redact secrets from an Error object
 * @param error - Error object to redact
 * @param secrets - Set of secret strings to redact
 * @returns Redacted error message and stack trace
 */
export function redactError(
  error: Error,
  secrets: Set<string>,
): {
  message: string
  stack?: string
} {
  const redacted = {
    message: redactSecrets(error.message, secrets),
    stack: error.stack ? redactSecrets(error.stack, secrets) : undefined,
  }

  return redacted
}

export default {
  redactSecrets,
  redactMultiple,
  redactObject,
  redactError,
}
