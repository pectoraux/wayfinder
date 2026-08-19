// Wayfinder — Blocker Analyzer
//
// Classifies each blocker on a route by who controls it (user, third-party,
// external, policy) and identifies what would unlock it. This is the engine
// behind the "What would unlock this?" UI.

import type { Route, MobilityState } from '@/lib/domain/types'
import type { BlockerAnalysis, BlockerCategory, UnlockOption } from './types'
import { getEnablersForAddressal } from '@/lib/knowledge/enablers'

/** Analyze all blockers on a route and classify them. */
export function analyzeBlockers(route: Route, state: MobilityState): BlockerAnalysis[] {
  return route.eligibility.blockers.map((b) => {
    const category = classifyBlocker(b.label, b.reason)
    const unlocks = identifyUnlocks(b.label, b.addressableVia.map((a) => a.kind), route.countryCode)
    const difficulty = assessDifficulty(b.label, category)
    const resolutionMonths = estimateResolutionMonths(b.label, category, difficulty)

    return {
      blockerId: b.requirementId,
      label: b.label,
      reason: b.reason,
      category,
      userAction: category === 'USER_CONTROLLED' ? userActionFor(b.label) : undefined,
      thirdPartyRole: category === 'THIRD_PARTY' ? thirdPartyRoleFor(b.label) : undefined,
      difficulty,
      estimatedResolutionMonths: resolutionMonths,
      unlocks,
    }
  })
}

/** Classify a blocker by who controls it. */
function classifyBlocker(label: string, reason: string): BlockerCategory {
  const l = label.toLowerCase()
  const r = reason.toLowerCase()

  // Third-party: requires an external actor
  if (l.includes('employer') || l.includes('job offer') || l.includes('sponsorship')) return 'THIRD_PARTY'
  if (l.includes('incubator') || l.includes('letter of support')) return 'THIRD_PARTY'
  if (l.includes('endorsement') || l.includes('tech nation')) return 'THIRD_PARTY'

  // External: depends on an external process
  if (l.includes('credential') || l.includes('recognition') || l.includes('degree')) return 'EXTERNAL'
  if (l.includes('points') && r.includes('below')) return 'USER_CONTROLLED' // points can be improved by the user

  // Policy-dependent
  if (l.includes('suspended') || l.includes('program')) return 'POLICY_DEPENDENT'

  // User-controlled: the user can fix this themselves
  if (l.includes('language') || l.includes('german') || l.includes('english') || l.includes('french')) return 'USER_CONTROLLED'
  if (l.includes('savings') || l.includes('funds') || l.includes('income') || l.includes('salary')) return 'USER_CONTROLLED'
  if (l.includes('business plan') || l.includes('founder')) return 'USER_CONTROLLED'
  if (l.includes('age')) return 'USER_CONTROLLED'

  return 'EXTERNAL'
}

/** Identify what would unlock a blocker. */
function identifyUnlocks(blockerLabel: string, addressalKinds: string[], countryCode: string): UnlockOption[] {
  const unlocks: UnlockOption[] = []
  const l = blockerLabel.toLowerCase()

  if (l.includes('degree') || l.includes('credential') || l.includes('recognition')) {
    unlocks.push({
      kind: 'credential_recognition',
      label: 'Obtain credential recognition',
      description: `Submit your degree for official recognition in ${countryCode}.`,
      enablerIds: getEnablersForAddressal('credential_recognition', countryCode).map((e) => e.id),
      userActionable: true,
      estimatedMonths: 2,
    })
  }

  if (l.includes('employer') || l.includes('job offer') || l.includes('sponsorship')) {
    unlocks.push({
      kind: 'employer_offer',
      label: 'Secure a qualifying employer offer',
      description: `Find an employer in ${countryCode} willing to sponsor your visa.`,
      enablerIds: getEnablersForAddressal('employer_offer', countryCode).map((e) => e.id),
      userActionable: true,
      estimatedMonths: 3,
    })
  }

  if (l.includes('incubator') || l.includes('letter of support')) {
    unlocks.push({
      kind: 'incubator_support',
      label: 'Secure incubator support',
      description: `Apply to a designated incubator that can issue a Letter of Support.`,
      enablerIds: getEnablersForAddressal('designated_incubator_support', countryCode).map((e) => e.id),
      userActionable: true,
      estimatedMonths: 4,
    })
  }

  if (l.includes('endorsement')) {
    unlocks.push({
      kind: 'endorsement',
      label: 'Obtain endorsement',
      description: `Apply for endorsement from the relevant endorsing body.`,
      enablerIds: getEnablersForAddressal('endorsement', countryCode).map((e) => e.id),
      userActionable: true,
      estimatedMonths: 3,
    })
  }

  if (l.includes('language') || l.includes('german') || l.includes('english')) {
    unlocks.push({
      kind: 'language_cert',
      label: 'Achieve the required language level',
      description: 'Enroll in a language course and pass the certification exam.',
      enablerIds: getEnablersForAddressal('language_cert', countryCode).map((e) => e.id),
      userActionable: true,
      estimatedMonths: 6,
    })
  }

  if (l.includes('savings') || l.includes('funds')) {
    unlocks.push({
      kind: 'savings',
      label: 'Accumulate the required funds',
      description: 'Save additional funds to meet the settlement/savings threshold.',
      enablerIds: [],
      userActionable: true,
      estimatedMonths: 12,
    })
  }

  if (l.includes('business plan') || l.includes('founder')) {
    unlocks.push({
      kind: 'business_formation',
      label: 'Develop a qualifying business plan',
      description: 'Create an innovative, scalable business plan and register a venture.',
      enablerIds: getEnablersForAddressal('business_formation', countryCode).map((e) => e.id),
      userActionable: true,
      estimatedMonths: 2,
    })
  }

  // Generic fallback: if we have addressal kinds, create unlocks from them
  if (unlocks.length === 0) {
    for (const kind of addressalKinds) {
      const enablers = getEnablersForAddressal(kind as any, countryCode)
      unlocks.push({
        kind: 'documentation',
        label: `Address: ${kind.replace(/_/g, ' ')}`,
        description: `Resolve the "${blockerLabel}" requirement.`,
        enablerIds: enablers.map((e) => e.id),
        userActionable: enablers.length > 0,
        estimatedMonths: 2,
      })
    }
  }

  return unlocks
}

function assessDifficulty(label: string, category: BlockerCategory): BlockerAnalysis['difficulty'] {
  const l = label.toLowerCase()
  if (l.includes('language') && l.includes('c1')) return 'hard'
  if (l.includes('employer') || l.includes('incubator') || l.includes('endorsement')) return 'hard'
  if (l.includes('savings') || l.includes('funds')) return 'moderate'
  if (l.includes('credential') || l.includes('degree')) return 'moderate'
  if (l.includes('business plan')) return 'moderate'
  if (category === 'POLICY_DEPENDENT') return 'very_hard'
  return 'moderate'
}

function estimateResolutionMonths(label: string, _category: BlockerCategory, difficulty: BlockerAnalysis['difficulty']): number {
  const l = label.toLowerCase()
  if (l.includes('c1')) return 12
  if (l.includes('b1') || l.includes('b2')) return 6
  if (l.includes('employer')) return 3
  if (l.includes('incubator')) return 4
  if (l.includes('endorsement')) return 3
  if (l.includes('credential')) return 2
  if (l.includes('savings')) return 12
  if (l.includes('business plan')) return 2
  switch (difficulty) {
    case 'easy': return 1
    case 'moderate': return 3
    case 'hard': return 6
    case 'very_hard': return 12
  }
}

function userActionFor(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('language') || l.includes('german')) return 'Enroll in a language course and pass the certification exam.'
  if (l.includes('savings') || l.includes('funds')) return 'Accumulate additional savings to meet the threshold.'
  if (l.includes('income') || l.includes('salary')) return 'Increase your income through career advancement or additional remote work.'
  if (l.includes('business plan')) return 'Develop an innovative, scalable business plan.'
  if (l.includes('points')) return 'Improve your language level, gain additional experience, or secure an employer offer to increase your points.'
  return 'Take action to meet this requirement.'
}

function thirdPartyRoleFor(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('employer')) return 'A qualifying employer must offer a genuine role meeting the salary threshold.'
  if (l.includes('incubator')) return 'A designated incubator must accept your venture and issue a Letter of Support.'
  if (l.includes('endorsement')) return 'An endorsing body must verify your exceptional talent or promise.'
  return 'An external actor must provide a legitimate qualification.'
}
