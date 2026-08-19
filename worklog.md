# Wayfinder — Build Worklog

Master build log for the Wayfinder global mobility intelligence platform.

Architecture thesis: `evidence → structured facts → policy evaluation → route optimization → explanation`
The LLM is NEVER the source of truth for immigration law. It only structures intent, discovers alternative objectives, and explains deterministic outputs.

---
Task ID: 0
Agent: main (founding CTO)
Task: Inspect codebase, plan architecture for the Wayfinder vertical slice.

Work Log:
- Inspected Next.js 16 scaffold: Tailwind 4, shadcn/ui (New York), Prisma+SQLite, z-ai-web-dev-sdk, recharts, framer-motion, zustand all available.
- Read LLM skill docs (zai.chat.completions.create, assistant role for system prompt, thinking disabled).
- Decided vertical slice: a Kenya software engineer scenario with 8 grounded pathways (Germany Blue Card + Chancenkarte, Portugal D7 + D2/Startup, Canada Express Entry + Start-Up Visa, Estonia Startup Visa, UK Global Talent, UAE Virtual Work).
- Decided split: pathway/policy/evidence data = versioned static TS knowledge base (deterministic, reproducible). User state + decision ledger = Prisma/SQLite.

Stage Summary:
- Architecture decided. Knowledge base in code (versioned), user data in DB.
- Domain pillars: MobilityState, Intent, PolicyEngine, RouteEngine, Frontier, Counterfactual, EnablerGraph, DecisionLedger.
- LLM confined to: intake parsing, alternative-intent suggestion, explanation prose. All with deterministic fallback.

---
Task ID: 1-9
Agent: main (founding CTO)
Task: Build the complete Wayfinder vertical slice — foundation, knowledge base, deterministic engine, AI layer, API, UI, visualizations, and browser verification.

Work Log:
- Foundation: cartographic/navigation theme (parchment + emerald-teal + amber); Prisma schema (Person, MobilityStateSnapshot, IntentRecord, DecisionRecord, Scenario, ConsentRecord — append-only for reproducibility); comprehensive domain types (MobilityState, Intent, Pathway, Requirement, Evidence, Route, Frontier, Enabler, Plan, DecisionLedger).
- Knowledge base (versioned, in code): 7 countries, 9 grounded pathways (DE Blue Card, DE Chancenkarte, PT D7, PT D2/Startup, CA Express Entry, CA Start-Up Visa, EE Startup Visa, UK Global Talent, UAE Virtual Work) with real requirements/downstream transitions/costs/timelines; 16 evidence records citing real government sources (Make it in Germany, BAMF, Anabin, Vistos.pt, IAPMEI, IRCC, Startup Estonia, GOV.UK, Tech Nation, UAE ICP); 10 enabler nodes (employers, incubators, endorsement bodies, credential evaluators, language providers, law firms) with legitimacy classification.
- Deterministic policy engine: per-requirement predicates (salary with shortage reduction, degree recognition, language CEFR, points systems for Chancenkarte + FSW 67-point grid, settlement funds, etc.) producing EligibilityResult with satisfied/failed/unknown + blockers + enabler addressals. NO LLM in the eligibility path.
- Route engine: graph search over pathways + downstream transitions → Route objects with 11-dimension scores. Frontier: Pareto dominance on priority-selected dimensions. Optimization: ranking, recommendation (why/blocker/next/sensitivity), alternative-intent discovery (4 templates re-ranked under shifted priorities).
- Counterfactual simulator: 7 "What if?" scenarios (German B1/C1, income +30%, master's, savings 2x, start business, degree recognition in DE) that recompute the full plan and report route shifts + score deltas + newly eligible/blocked. Insight generation explains WHY when nothing changes (binding constraints are third-party).
- AI layer (backend, z-ai-web-dev-sdk): intent parser (LLM → structured Intent, validated, deterministic fallback); explanation agent (LLM → narrative prose from deterministic plan digest, fallback to assembled strings). Both demand strict JSON and never change a fact/ranking.
- API: POST /api/intent/parse, POST /api/mobility/plan (returns plan + narrative + evidence), POST /api/mobility/simulate, POST /api/decision (reproducible ledger), GET /api/frontier (knowledge base).
- UI: home intent intake ("What are you trying to make possible?"), progressive 4-step intake wizard, computing view, results dashboard composing: recommendation header (best route + LLM narrative + intent-assessment banner), route list + route detail (tabs: eligibility/scores/blockers/evidence), navigation route-map SVG (current→entry→PR→citizenship with blocked steps + enabler satellites), mobility frontier Pareto scatter (selectable axes), counterfactual panel, enabler list (consent-gated), alternative intents, decision ledger (save to DB). Error boundary added for debuggability.
- Verification (agent-browser): full flow exercised end-to-end. Best route = Portugal D7 (Pareto-optimal, eligible). 9 routes, 8 Pareto. Route selection updates detail. Counterfactuals work — "If my degree is recognized in Germany" shifts best route to DE Chancenkarte (+1 newly eligible, Residence +53, Citizenship −87). Evidence trail shows official AIMA/Vistos.pt source. Footer correctly pushed to bottom on long pages. Mobile (390px) responsive, no horizontal overflow. Console clean. Fixed two bugs during verification: route.estimatedCostUSD→totalCostUSD crash; ScrollArea root missing overflow-hidden causing counterfactual content to overflow past footer.

Stage Summary:
- Working production-quality prototype proving the architecture: evidence → structured facts → policy evaluation → route optimization → explanation. The LLM is confined to intent parsing + explanation prose; every legally significant claim is traceable to a cited government source.
- The Kenya software-engineer demo produces the spec's target experience: routes identified, best route explained, blockers + legitimate enablers shown, alternative intents surfaced ("a better goal you may want to consider"), counterfactuals recalculated, decision ledger reproducible.
- Policy version 2024.11.1 (hash wf-kb-0011) curated; figures flagged as planning approximations with a primary-source disclaimer.

---
Task ID: 10-12
Agent: main (founding CTO)
Task: Add authentication system (waitlist + admin approval + demo accounts), migrate to Neon PostgreSQL, push to GitHub, deploy to Vercel with all env vars, verify identical behavior.

Work Log:
- Migrated Prisma SQLite → Neon PostgreSQL (pooled runtime + direct migration URLs). Added User (role: USER/ADMIN/DEMO), WaitlistEntry models; linked Person to User.
- Built NextAuth (JWT strategy, credentials provider, serverless-friendly). Middleware protects all routes except /login, /signup, /api/auth, /api/waitlist; /admin requires ADMIN role.
- Waitlist flow: POST /api/waitlist creates a pending entry (no account). Admin logs in at /admin, sees pending requests, sets a password, approves → account created, entry marked APPROVED. User can then log in.
- Seed script (scripts/seed.ts, idempotent): real admin ekontetevi@gmail.com / Payswap123456; demo-user@wayfinder.app / wayfinder (DEMO); demo-admin@wayfinder.app / wayfinder (ADMIN). Quick-login links on /login for both demo accounts.
- Made z-ai-web-dev-sdk env-var driven (src/lib/ai/zai.ts): constructs the client from ZAI_BASE_URL + ZAI_API_KEY on Vercel (no .z-ai-config file needed), falls back to local file in dev, and to deterministic parsing if neither is available. The app works identically with or without the LLM.
- Vercel readiness: build script = `next build` (removed standalone cp commands); added `postinstall: prisma generate`; next.config serverExternalPackages for bcryptjs/@prisma/client; .gitignore excludes .env, db/, download/, .z-ai-config but allows .env.example.
- GitHub: created repo pectoraux/wayfinder (public) via API with PAT; pushed (PAT removed from remote URL after push). Verified .env is NOT on GitHub (404), .env.example IS.
- Vercel: created project `wayfinder` (prj_3qLp1yOG7sUCFRqMrdhQj776wyxA) linked to GitHub repo; set 6 env vars (DATABASE_URL, DIRECT_DATABASE_URL, NEXTAUTH_SECRET [generated], NEXTAUTH_URL, ZAI_BASE_URL, ZAI_API_KEY) targeting production/preview/development; triggered production deploy from main; build succeeded (READY).
- Production domains: wayfinder-one.vercel.app and wayfinder-mobility.vercel.app (wayfinder.vercel.app and wayfindr.vercel.app were already taken by other projects).
- Verification (agent-browser against Vercel): / redirects to /login (middleware ✓); demo user quick-login ✓; full mobility plan renders (best route, frontier, counterfactuals, enablers) ✓; decision ledger save writes to Neon (cuid returned) ✓; waitlist signup writes to Neon ✓; real admin login + approve waitlist user ✓; newly-approved user logs in ✓. App behaves identically to local.

Stage Summary:
- Live at https://wayfinder-mobility.vercel.app and https://wayfinder-one.vercel.app
- GitHub: https://github.com/pectoraux/wayfinder
- Auth: real admin (ekontetevi@gmail.com / Payswap123456) + 2 demo accounts with quick login. Sign-up is waitlist-only; admin approves and creates accounts from /admin.
- DB: Neon PostgreSQL (shared between local dev and Vercel — same connection strings).
- LLM: env-var driven; deterministic fallbacks ensure identical app behavior even if the Z.ai internal API is unreachable from Vercel.
- All secrets in Vercel project env vars (encrypted); .env excluded from GitHub.
- Note: the user's PAT and Vercel token should be rotated now (they stated they would).

---
Task ID: 13-15
Agent: main (founding CTO)
Task: Build the Temporal Mobility Intelligence Layer — versioned, evidence-backed policy representation with snapshots, diffs, route invalidation, impact analysis, historical mode, and tests.

Work Log:
- Inspected the full codebase: existing Pathway model has effectiveFrom strings but no real temporal model; PolicyVersion is a single global object; route engine iterates static PATHWAYS with no asOfDate.
- DATABASE DECISION (§22): HYBRID architecture. Normalized knowledge model (Jurisdiction, ImmigrationProgram, ImmigrationStatus, NormalizedRequirement, NormalizedTransition, PolicySnapshot, Source, SourceSnapshot) stays in versioned TypeScript. User-scoped data (DecisionRecord, Person) stays in PostgreSQL. Added PolicySource + SourceSnapshot tables to Prisma for future change-detection persistence.
- New normalized domain model (src/lib/policy/types.ts): Jurisdiction, ImmigrationProgram, ImmigrationStatus, NormalizedRequirement (with VerificationState: AI_EXTRACTED → PENDING_VERIFICATION → HUMAN_REVIEWED → OFFICIAL_CONFIRMED), NormalizedTransition, PolicySnapshot, Source, SourceSnapshot, PolicyChange, PolicyDiff, RouteInvalidation, PolicyImpact.
- Normalized knowledge base (src/lib/policy/knowledge.ts): 8 jurisdictions, 15 immigration statuses, 9 v1 programs + 3 v2 changed programs (DE Blue Card threshold raised, PT D7 income raised, CA SUV suspended), 28 requirements (with supersession chains), 16 transitions, 2 policy snapshots (snap-2024-11 current + snap-2026-01 hypothetical).
- Policy snapshot API (src/lib/policy/snapshot.ts): getPolicySnapshot(jurisdiction, asOf), getCurrentPolicySnapshot, comparePolicySnapshots(a, b) → structured PolicyDiff with THRESHOLD_CHANGED, PROGRAM_SUSPENDED, REQUIREMENT_ADDED/REMOVED, TRANSITION_ADDED/REMOVED, EFFECTIVE_DATE_CHANGED, etc.
- MobilityGraph abstraction (src/lib/graph/mobility-graph.ts): buildGraph, getNeighbors, findPaths (BFS), getReachableStatuses, getRequirements, isRouteStillValid, getRouteInvalidationReasons, getAffectedRoutes, getAffectedTransitions, getPolicyImpact. Storage layer is swappable.
- Extraction pipeline (src/lib/policy/extraction.ts): extractCandidateRequirements (LLM-backed, returns AI_EXTRACTED candidates), verification state machine (canTransition, promoteCandidate), publishCandidate (throws if not OFFICIAL_CONFIRMED — the single chokepoint preventing AI-extracted rules from becoming policy), onlyAuthoritative filter.
- Source registry + change detection (src/lib/policy/sources.ts): SOURCES derived from EVIDENCE records, contentHash (SHA-256 normalized), detectSourceChange, classifyChange (TEXT_CHANGED vs POSSIBLE_POLICY_CHANGE).
- Migration adapter (src/lib/policy/normalize.ts): pathwayToProgram, getNormalizedRequirementsForPathway, getNormalizedTransitionsForPathway — bridges legacy Pathway (used by the existing route engine) to the normalized model without rewriting the working engine.
- Route engine threading (src/lib/engine/routes.ts): generateRoutes now accepts asOfDate, resolves the active policy snapshot, and swaps in superseded requirements (e.g. the 2026 Blue Card threshold when asOfDate >= 2026-01-01). buildPlan and runScenario thread asOfDate through. MobilityPlan now carries policySnapshotId.
- API routes: /api/policy/snapshot (GET, with ?asOf or ?id), /api/policy/diff (GET, ?from&to), /api/policy/affected (GET, impact analysis with DB-backed decision records), /api/route/validate (POST, isRouteStillValid).
- UI: PolicyTransparencyCard (per-requirement evidence with effective dates, verification status, policy version, expandable excerpts, AI_EXTRACTED warning), ChangeSignal (flags invalidated routes with alternatives), HistoricalModePicker (as-of date picker that recomputes the plan), /policy explorer page (snapshots tab, diff tab with structured changes, about tab).
- Tests (tests/policy.test.ts, 45 tests, all passing): temporal policy selection, supersession, eligibility across versions (same user → different threshold under v1 vs v2), route invalidation (CA SUV suspended, DE Blue Card threshold raised), policy diff (threshold + suspension + income changes detected, every change has evidence), historical reproducibility (plan records snapshot id+hash, deterministic recompute, historical plan doesn't silently recompute), evidence linkage (every published requirement has evidence, every evidence id resolves), AI extraction boundaries (AI_EXTRACTED not authoritative, state machine rejects illegal transitions, publishCandidate throws), MobilityGraph operations, source change detection, impact analysis.
- Verification: lint clean, 45/45 tests pass, main flow intact (demo user → full plan renders), historical mode works (as-of 2025-06-01 → snapshot 2024-11; as-of 2026-06-01 → snapshot 2026-01), change signal appears when plan is under v1 but v2 is latest, policy explorer page renders snapshots + diff + about tabs.

Stage Summary:
- The legal-policy foundation is now worthy of the strategy engine: versioned snapshots, evidence-backed requirements, deterministic diff engine, route invalidation, impact analysis, historical reproducibility, and AI extraction boundaries enforced by a state machine.
- 9 real pathways refactored into the normalized model; 2 policy snapshots coexist for diff/invalidation demos.
- The existing product flow is preserved — the route engine still works identically when asOfDate is omitted.
- snap-2026-01 is clearly labelled HYPOTHETICAL for demonstrating the temporal APIs; it is NOT presented as current law.
