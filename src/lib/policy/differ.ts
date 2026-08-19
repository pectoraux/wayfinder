// Wayfinder — Document Diffing
//
// When a source changes materially, generate a human-readable diff with
// surrounding context so an expert can understand what changed.

import type { DocumentDiff, DiffSection } from './types'

/** Split text into lines, normalizing line endings. */
function toLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

/** A simple line-level diff using LCS. Good enough for review — not a
 *  production-grade diffing library, but produces clear before/after context. */
export function diffDocuments(beforeText: string, afterText: string): DocumentDiff {
  const beforeLines = toLines(beforeText)
  const afterLines = toLines(afterText)

  // Find changed regions: lines present in one but not the other, near each other
  const beforeSet = new Set(beforeLines.map((l) => l.trim()).filter(Boolean))
  const afterSet = new Set(afterLines.map((l) => l.trim()).filter(Boolean))

  const lines: { type: 'context' | 'added' | 'removed'; text: string }[] = []
  const maxLen = Math.max(beforeLines.length, afterLines.length)
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i]?.trim() ?? ''
    const a = afterLines[i]?.trim() ?? ''
    if (b === a) {
      if (b) lines.push({ type: 'context', text: b })
    } else {
      if (b && !afterSet.has(b)) lines.push({ type: 'removed', text: b })
      if (a && !beforeSet.has(a)) lines.push({ type: 'added', text: a })
      if (b && afterSet.has(b) && b !== a) lines.push({ type: 'context', text: b })
      if (a && beforeSet.has(a) && b !== a) lines.push({ type: 'context', text: a })
    }
  }

  // Group into sections around changed lines, with context
  const sections: DiffSection[] = []
  let currentSection: DiffSection | null = null
  const CONTEXT_RADIUS = 2

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.type === 'added' || line.type === 'removed') {
      if (!currentSection) {
        currentSection = { before: '', after: '', lines: [] }
        // Include preceding context
        for (let j = Math.max(0, i - CONTEXT_RADIUS); j < i; j++) {
          if (lines[j].type === 'context') currentSection.lines.push(lines[j])
        }
      }
      currentSection.lines.push(line)
    } else if (currentSection) {
      currentSection.lines.push(line)
      // If we've had enough trailing context, close the section
      const lastChange = currentSection.lines.reduce((acc, l, idx) =>
        l.type !== 'context' ? idx : acc, -1)
      if (currentSection.lines.length - lastChange - 1 >= CONTEXT_RADIUS) {
        sections.push(currentSection)
        currentSection = null
      }
    }
  }
  if (currentSection) sections.push(currentSection)

  // Populate before/after per section
  for (const s of sections) {
    s.before = s.lines.filter((l) => l.type !== 'added').map((l) => l.text).join('\n')
    s.after = s.lines.filter((l) => l.type !== 'removed').map((l) => l.text).join('\n')
  }

  return { before: beforeText, after: afterText, sections }
}

/** Summarize a diff for the review queue. */
export function summarizeDiff(diff: DocumentDiff): string {
  const added = diff.sections.flatMap((s) => s.lines.filter((l) => l.type === 'added')).length
  const removed = diff.sections.flatMap((s) => s.lines.filter((l) => l.type === 'removed')).length
  if (added === 0 && removed === 0) return 'No material content changes detected.'
  return `${added} line(s) added, ${removed} line(s) removed across ${diff.sections.length} section(s).`
}
