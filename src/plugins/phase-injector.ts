/**
 * Phase Injector for KASO
 *
 * Inserts custom phases at configurable positions in the pipeline.
 * Custom phases receive same AgentContext passing behavior as built-in phases.
 * Custom phase failures follow same error handling as built-in phases.
 *
 * Requirements: 23.1, 23.2, 23.3
 */

import type { PhaseName } from '@/core/types'
import type { CustomPhaseConfig } from '@/config/schema'

/**
 * Represents a phase in the pipeline (built-in or custom)
 */
export interface PipelinePhase {
  name: PhaseName
  type: 'built-in' | 'custom'
  package?: string
  position?: number
}

/**
 * Default built-in phases in order
 */
export const BUILTIN_PHASES: PhaseName[] = [
  'intake',
  'validation',
  'architecture-analysis',
  'implementation',
  'architecture-review',
  'test-verification',
  'ui-validation',
  'review-delivery',
]

/**
 * Validates a custom phase name
 */
export function validateCustomPhaseName(name: string): {
  valid: boolean
  error?: string
} {
  if (!name.startsWith('custom-')) {
    return {
      valid: false,
      error: `Custom phase name must start with 'custom-': ${name}`,
    }
  }

  // Check format: custom-[a-z0-9-]+
  const validPattern = /^custom-[a-z0-9-]+$/
  if (!validPattern.test(name)) {
    return {
      valid: false,
      error: `Custom phase name must match pattern 'custom-[a-z0-9-]+': ${name}`,
    }
  }

  return { valid: true }
}

/**
 * Validates a position in the pipeline
 */
export function validatePosition(position: number): {
  valid: boolean
  error?: string
} {
  if (position < 0 || position > BUILTIN_PHASES.length) {
    return {
      valid: false,
      error: `Position must be between 0 and ${BUILTIN_PHASES.length}: ${position}`,
    }
  }

  return { valid: true }
}

/**
 * Result of injecting custom phases
 */
export interface PhaseInjectionResult {
  phases: PipelinePhase[]
  customPhases: Map<PhaseName, CustomPhaseConfig>
  errors: string[]
}

/**
 * Inject custom phases into the pipeline
 */
export function injectCustomPhases(
  customPhaseConfigs: CustomPhaseConfig[],
): PhaseInjectionResult {
  const phases: PipelinePhase[] = BUILTIN_PHASES.map((name) => ({
    name,
    type: 'built-in' as const,
  }))

  const customPhases = new Map<PhaseName, CustomPhaseConfig>()
  const errors: string[] = []

  // Sort custom phases by position
  const sortedConfigs = [...customPhaseConfigs].sort(
    (a, b) => a.position - b.position,
  )

  for (const config of sortedConfigs) {
    // Validate phase name
    const nameValidation = validateCustomPhaseName(config.name)
    if (!nameValidation.valid) {
      errors.push(nameValidation.error!)
      continue
    }

    // Validate position
    const positionValidation = validatePosition(config.position)
    if (!positionValidation.valid) {
      errors.push(positionValidation.error!)
      continue
    }

    // Check for duplicate phase names
    if (customPhases.has(config.name as PhaseName)) {
      errors.push(`Duplicate custom phase name: ${config.name}`)
      continue
    }

    // Check for collision with built-in phases
    if (BUILTIN_PHASES.includes(config.name as PhaseName)) {
      errors.push(
        `Custom phase name conflicts with built-in phase: ${config.name}`,
      )
      continue
    }

    // Insert the custom phase at the specified position
    const phase: PipelinePhase = {
      name: config.name as PhaseName,
      type: 'custom',
      package: config.package,
      position: config.position,
    }

    phases.splice(config.position, 0, phase)
    customPhases.set(config.name as PhaseName, config)
  }

  return { phases, customPhases, errors }
}

/**
 * Get the ordered list of phase names from injection result
 */
export function getPhaseOrder(result: PhaseInjectionResult): PhaseName[] {
  return result.phases.map((p) => p.name)
}

/**
 * Check if a phase is a custom phase
 */
export function isCustomPhase(
  result: PhaseInjectionResult,
  phaseName: PhaseName,
): boolean {
  return result.customPhases.has(phaseName)
}

/**
 * Get custom phase configuration
 */
export function getCustomPhaseConfig(
  result: PhaseInjectionResult,
  phaseName: PhaseName,
): CustomPhaseConfig | undefined {
  return result.customPhases.get(phaseName)
}

/**
 * Phase Injector class for managing custom phases
 */
export class PhaseInjector {
  private result: PhaseInjectionResult | null = null

  constructor(private customPhaseConfigs: CustomPhaseConfig[]) {}

  /**
   * Build the pipeline with custom phases injected
   */
  buildPipeline(): PhaseInjectionResult {
    this.result = injectCustomPhases(this.customPhaseConfigs)
    return this.result
  }

  /**
   * Get the current pipeline result
   */
  getPipeline(): PhaseInjectionResult | null {
    return this.result
  }

  /**
   * Get the ordered list of phase names
   */
  getPhaseOrder(): PhaseName[] {
    if (!this.result) {
      return [...BUILTIN_PHASES]
    }
    return getPhaseOrder(this.result)
  }

  /**
   * Check if there were any errors
   */
  hasErrors(): boolean {
    return this.result ? this.result.errors.length > 0 : false
  }

  /**
   * Get errors from phase injection
   */
  getErrors(): string[] {
    return this.result ? [...this.result.errors] : []
  }

  /**
   * Validate that all custom phases have corresponding agents
   */
  validateAgents(registeredPhases: Set<PhaseName>): {
    valid: boolean
    missing: PhaseName[]
  } {
    if (!this.result) {
      return { valid: true, missing: [] }
    }

    const missing: PhaseName[] = []
    for (const [phaseName] of this.result.customPhases) {
      if (!registeredPhases.has(phaseName)) {
        missing.push(phaseName)
      }
    }

    return { valid: missing.length === 0, missing }
  }
}

/**
 * Create a phase injector instance
 */
export function createPhaseInjector(
  customPhaseConfigs: CustomPhaseConfig[],
): PhaseInjector {
  return new PhaseInjector(customPhaseConfigs)
}
