/**
 * Mock Project Fixture for E2E Testing
 *
 * Creates temporary project directories with valid Kiro specs,
 * steering files, and kaso.config.json for E2E testing.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { KASOConfig } from '@/config/schema'

/**
 * Configuration for mock project creation
 */
export interface MockProjectConfig {
  /** Feature name for the spec */
  featureName?: string
  /** Custom spec content */
  specContent?: {
    designMd?: string
    tasksMd?: string
  }
  /** Custom steering files content */
  steeringFiles?: {
    codingPractices?: string
    personality?: string
  }
  /** Config overrides */
  configOverrides?: Partial<KASOConfig>
}

/**
 * Result of creating a mock project
 */
export interface MockProjectResult {
  /** Path to the temporary project directory */
  projectDir: string
  /** Path to the mock spec directory */
  specPath: string
  /** Path to the generated kaso.config.json */
  configPath: string
  /** Cleanup function to remove the temp directory */
  cleanup: () => Promise<void>
}

/**
 * Create a temporary mock project directory with all necessary files
 * @param config - Configuration for the mock project
 * @returns Promise resolving to project paths and cleanup function
 */
export async function createMockProject(
  config?: MockProjectConfig,
): Promise<MockProjectResult> {
  const featureName = config?.featureName ?? 'mock-feature'
  const tempDir = createTempDir(`kaso-e2e-${featureName}`)

  try {
    // Create directory structure
    const kiroDir = join(tempDir, '.kiro')
    const specsDir = join(kiroDir, 'specs', featureName)
    const steeringDir = join(kiroDir, 'steering')

    mkdirSync(specsDir, { recursive: true })
    mkdirSync(steeringDir, { recursive: true })

    // Create spec files
    const requirementsMd = createDefaultRequirementsMd(featureName)
    const designMd =
      config?.specContent?.designMd ?? createDefaultDesignMd(featureName)
    const tasksMd = config?.specContent?.tasksMd ?? createDefaultTasksMd()

    writeFileSync(join(specsDir, 'requirements.md'), requirementsMd)
    writeFileSync(join(specsDir, 'design.md'), designMd)
    writeFileSync(join(specsDir, 'tasks.md'), tasksMd)

    // Create steering files
    const codingPractices =
      config?.steeringFiles?.codingPractices ?? createDefaultCodingPractices()
    const personality =
      config?.steeringFiles?.personality ?? createDefaultPersonality()

    writeFileSync(join(steeringDir, 'coding-practices.md'), codingPractices)
    writeFileSync(join(steeringDir, 'personality.md'), personality)

    // Create kaso.config.json
    const kasoConfig = createKasoConfig(config?.configOverrides)
    const configPath = join(tempDir, 'kaso.config.json')
    writeFileSync(configPath, JSON.stringify(kasoConfig, null, 2))

    // Create package.json in project root for dependency extraction
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: featureName, dependencies: {} }, null, 2),
    )

    return {
      projectDir: tempDir,
      specPath: specsDir,
      configPath,
      cleanup: async () => {
        await cleanupTempDir(tempDir)
      },
    }
  } catch (error) {
    // Clean up on error
    await cleanupTempDir(tempDir)
    throw error
  }
}

/**
 * Create a temporary directory
 * @param prefix - Directory name prefix
 * @returns Path to the created directory
 */
function createTempDir(prefix: string): string {
  const timestamp = Date.now()
  const randomSuffix = Math.random().toString(36).substring(2, 8)
  const dir = join(tmpdir(), `${prefix}-${timestamp}-${randomSuffix}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Clean up a temporary directory
 * @param dir - Directory to remove
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Create default requirements.md content
 * @param featureName - Name of the feature
 * @returns Requirements markdown content
 */
function createDefaultRequirementsMd(featureName: string): string {
  return `# Requirements: ${featureName}

## Introduction

Requirements for the ${featureName} feature.

## Glossary

- **Widget**: A reusable UI component for displaying data

## Requirements

### Requirement 1: Widget Creation

**User Story:** As a user, I want to create widgets so that I can display data.

#### Acceptance Criteria

1. WHEN a user submits valid widget data THEN the system SHALL create a widget
2. WHEN a widget is created THEN the system SHALL assign a unique identifier

## Data Model

\`\`\`typescript
interface Widget {
  id: string;
  name: string;
}
\`\`\`
`
}

/**
 * Create default design.md content with EARS-pattern acceptance criteria
 * @param featureName - Name of the feature
 * @returns Design markdown content
 */
function createDefaultDesignMd(featureName: string): string {
  return `# Design Document: ${featureName}

## Introduction

A mock feature for E2E validation testing.

## Glossary

- **Widget**: A reusable UI component

## Requirements

### Requirement 1: Widget Creation

**User Story:** As a user, I want to create widgets.

#### Acceptance Criteria

1. WHEN a user submits valid widget data THEN the system SHALL create a widget
2. WHEN a widget is created THEN the system SHALL assign a unique identifier

## Implementation Details

The feature will include request and response schemas:

Request body schema:
\`\`\`json
{
  "name": "string",
  "type": "chart"
}
\`\`\`

Response body schema:
\`\`\`json
{
  "id": "widget_123456",
  "name": "string"
}
\`\`\`

## Data Model

\`\`\`typescript
interface Widget {
  id: string;
  name: string;
  createdAt: Date;
}
\`\`\`

The data storage uses a structured format with proper data organization.

## Security

Authentication and authorization will be implemented.
`
}

/**
 * Create default tasks.md content
 * @returns Tasks markdown content
 */
function createDefaultTasksMd(): string {
  return `# Tasks

## Phase 1: Foundation

- [x] 1.0 Setup project structure
- [x] 1.1 Configure build system
- [x] 1.2 Setup test framework

## Phase 2: Core Implementation

- [ ] 2.0 Implement widget creation
  - [ ] 2.1 Add widget model
  - [ ] 2.2 Add widget service
  - [ ] 2.3 Add widget controller
- [ ] 2.1 Implement widget retrieval
  - [ ] 2.4 Add retrieval logic
  - [ ] 2.5 Add error handling

## Phase 3: Testing

- [ ] 3.0 Write unit tests
- [ ] 3.1 Write integration tests
`
}

/**
 * Create default coding_practices.md content
 * @returns Coding practices markdown content
 */
function createDefaultCodingPractices(): string {
  return `# Coding Practices

## Code Style

- Use TypeScript for all new code
- Follow ESLint configuration
- Prefer const over let
- Use async/await over callbacks

## Testing

- Write unit tests for all public functions
- Maintain >80% code coverage
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

## Error Handling

- Use specific error types
- Always handle promise rejections
- Log errors with context
- Never swallow errors silently
`
}

/**
 * Create default personality.md content
 * @returns Personality markdown content
 */
function createDefaultPersonality(): string {
  return `# Personality

## Communication Style

- Be concise and clear
- Use technical terms appropriately
- Provide examples when explaining concepts
- Maintain a professional tone

## Code Review

- Focus on correctness first
- Suggest improvements politely
- Explain the 'why' behind suggestions
- Celebrate good solutions
`
}

/**
 * Create a valid KASO configuration for E2E tests
 * @param overrides - Config values to override
 * @returns KASO configuration object
 */
function createKasoConfig(overrides?: Partial<KASOConfig>): KASOConfig {
  const baseConfig: KASOConfig = {
    executorBackends: [
      {
        name: 'mock-backend',
        command: 'echo',
        args: [],
        protocol: 'cli-json',
        maxContextWindow: 128000,
        costPer1000Tokens: 0.01,
        enabled: true,
      },
    ],
    defaultBackend: 'mock-backend',
    backendSelectionStrategy: 'default',
    maxConcurrentAgents: 2,
    maxPhaseRetries: 2,
    defaultPhaseTimeout: 30,
    phaseTimeouts: {},
    phaseBackends: {},
    contextCapping: {
      enabled: true,
      charsPerToken: 4,
      relevanceRanking: ['requirements.md', 'design.md', 'tasks.md'],
    },
    reviewCouncil: {
      maxReviewRounds: 1,
      enableParallelReview: false,
      perspectives: ['security', 'performance', 'maintainability'],
    },
    uiBaseline: {
      baselineDir: '.kiro/ui-baselines',
      captureOnPass: true,
      diffThreshold: 0.1,
      viewport: {
        width: 1280,
        height: 720,
      },
    },
    webhooks: [],
    mcpServers: [],
    plugins: [],
    customPhases: [],
    executionStore: {
      type: 'sqlite',
      path: ':memory:',
    },
  }

  return { ...baseConfig, ...overrides } as KASOConfig
}
