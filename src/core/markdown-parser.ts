/**
 * Shared markdown parser utility
 * Extracts structured content from markdown documents including
 * sections, code blocks, and YAML frontmatter metadata.
 */

import type { ParsedMarkdown, MarkdownSection, CodeBlock } from './types'

/**
 * Parse markdown content into structured format
 */
export function parseMarkdown(content: string): ParsedMarkdown {
  const lines = content.split('\n')
  const sections: MarkdownSection[] = []
  const codeBlocks: CodeBlock[] = []
  const metadata: Record<string, string> = {}

  let currentSection: MarkdownSection | null = null
  const sectionStack: MarkdownSection[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    // Parse code blocks
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const startLine = i + 1
      let codeContent = ''
      i++

      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeContent += (lines[i] ?? '') + '\n'
        i++
      }

      if (i < lines.length) {
        const block: CodeBlock = {
          language: language || undefined,
          content: codeContent.trimEnd(),
          lineStart: startLine,
        }
        codeBlocks.push(block)

        if (currentSection) {
          currentSection.codeBlocks.push(block)
        }
      }
      continue
    }

    // Parse metadata (YAML frontmatter)
    if (
      line.trim() === '---' &&
      sections.length === 0 &&
      Object.keys(metadata).length === 0
    ) {
      i++
      while (i < lines.length && (lines[i] ?? '').trim() !== '---') {
        const metaLine = lines[i] ?? ''
        const colonIndex = metaLine.indexOf(':')
        if (colonIndex > 0) {
          const key = metaLine.slice(0, colonIndex).trim()
          const value = metaLine.slice(colonIndex + 1).trim()
          if (key && value) {
            metadata[key] = value
          }
        }
        i++
      }
      continue
    }

    // Parse headings and sections
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = (headingMatch[1] ?? '').length
      const title = (headingMatch[2] ?? '').trim()

      const newSection: MarkdownSection = {
        level,
        title,
        content: '',
        codeBlocks: [],
        children: [],
      }

      // Find parent in the stack
      while (
        sectionStack.length > 0 &&
        (sectionStack[sectionStack.length - 1]?.level ?? 0) >= level
      ) {
        sectionStack.pop()
      }

      const parent = sectionStack[sectionStack.length - 1]
      if (parent) {
        parent.children.push(newSection)
      } else {
        sections.push(newSection)
      }

      sectionStack.push(newSection)
      currentSection = newSection
    } else if (currentSection) {
      currentSection.content += line + '\n'
    }
  }

  return {
    rawContent: content,
    sections,
    codeBlocks,
    metadata,
  }
}
