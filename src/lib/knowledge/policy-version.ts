// Wayfinder Knowledge Base — Policy Version
//
// The knowledge base is versioned so historical recommendations remain
// reproducible. When policy rules change we bump the version, keep prior
// versions reachable, and the decision ledger references the version + hash
// that produced each recommendation.

import type { PolicyVersion } from '@/lib/domain/types'

export const POLICY_VERSION: PolicyVersion = {
  version: '2024.11.1',
  curatedAt: '2024-11-01',
  // A short semantic hash of the curated policy contents. In a production
  // system this would be computed from the serialized knowledge base; here it
  // is a stable identifier bumped whenever rules change.
  hash: 'wf-kb-0011',
  notes:
    'Initial curated vertical slice: Germany (Blue Card, Chancenkarte), Portugal (D7, D2/Startup Visa), Canada (Express Entry FSW, Start-Up Visa), Estonia (Startup Visa), UK (Global Talent), UAE (Virtual Working). Figures approximate for planning; verify primary sources.',
}
