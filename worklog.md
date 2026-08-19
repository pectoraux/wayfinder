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
