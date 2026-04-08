import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Smoke test verifying each E2E npm script glob resolves to the expected test files.
 * Uses shell expansion (ls) to match globs — same mechanism npm scripts use at runtime.
 */

const EXPECTED_SCRIPTS: Record<string, string[]> = {
  'test:e2e:tier1': ['tests/e2e/tier1-core-pipeline.e2e.test.ts'],
  'test:e2e:tier2': ['tests/e2e/tier2-error-recovery.e2e.test.ts'],
  'test:e2e:tier3': ['tests/e2e/tier3-integration.e2e.test.ts'],
  'test:e2e:tier4': ['tests/e2e/tier4-advanced.e2e.test.ts'],
  'test:e2e': [
    'tests/e2e/tier1-core-pipeline.e2e.test.ts',
    'tests/e2e/tier2-error-recovery.e2e.test.ts',
    'tests/e2e/tier3-integration.e2e.test.ts',
    'tests/e2e/tier4-advanced.e2e.test.ts',
  ],
}

/** Extract the glob patterns from an npm script command string */
function extractGlobs(scriptCmd: string): string[] {
  return scriptCmd.split(/\s+/).filter((arg) => arg.includes('tests/e2e/'))
}

/** Expand a shell glob pattern to matching file paths */
function expandGlob(pattern: string): string[] {
  try {
    const output = execSync(`ls -1 ${pattern}`, {
      encoding: 'utf-8',
      timeout: 5000,
    })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** Normalize path to forward slashes and strip leading ./ */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '')
}

describe('E2E npm script globs', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
    scripts: Record<string, string>
  }

  for (const [scriptName, expectedFiles] of Object.entries(EXPECTED_SCRIPTS)) {
    it(`"${scriptName}" matches expected test files`, () => {
      const scriptCmd = pkg.scripts[scriptName]
      expect(scriptCmd).toBeDefined()
      if (!scriptCmd) return

      const globs = extractGlobs(scriptCmd)
      expect(globs.length).toBeGreaterThan(0)

      const resolved = globs.flatMap(expandGlob).map(normalizePath)

      const expected = expectedFiles.map(normalizePath).sort()
      expect(resolved.sort()).toEqual(expected)
    })
  }

  it('every tier script exists in package.json', () => {
    const tierScripts = [
      'test:e2e',
      'test:e2e:tier1',
      'test:e2e:tier2',
      'test:e2e:tier3',
      'test:e2e:tier4',
    ]
    for (const name of tierScripts) {
      expect(pkg.scripts[name]).toBeDefined()
    }
  })

  it('tier scripts have appropriate timeouts', () => {
    const expectedTimeouts: Record<string, number> = {
      'test:e2e:tier1': 60000,
      'test:e2e:tier2': 120000,
      'test:e2e:tier3': 180000,
      'test:e2e:tier4': 300000,
    }

    for (const [scriptName, timeout] of Object.entries(expectedTimeouts)) {
      const cmd = pkg.scripts[scriptName]
      expect(cmd).toContain(`--testTimeout=${timeout}`)
    }
  })

  it('no tier glob matches zero files (dead glob detection)', () => {
    for (const [scriptName] of Object.entries(EXPECTED_SCRIPTS)) {
      const scriptCmd = pkg.scripts[scriptName]
      if (!scriptCmd) continue
      const globs = extractGlobs(scriptCmd)
      for (const pattern of globs) {
        const matches = expandGlob(pattern)
        expect(
          matches.length,
          `glob "${pattern}" in "${scriptName}" matched nothing`,
        ).toBeGreaterThan(0)
      }
    }
  })
})
