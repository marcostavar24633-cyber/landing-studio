# Free-first optimization audit — 2026-11-16

## Scope and operating rules

This audit covers Landing Studio as the central workspace/site-management layer and its integration with UNIQUE DESIGN STUDIO. Target architecture: free-first, useful without paid AI APIs, mandatory secrets, or a separately managed application server. AI integrations are optional enhancements, not prerequisites. Keep the current production branch and deployment untouched during the audit.

## Repository baseline

- Repository: `marcostavar24633-cyber/landing-studio`
- Default branch: `main`
- Main app includes a static dashboard/editor, project registry (`projects.json`), UDS vendor bundle (`vendor`), local helper, build scripts, tests, and hosting adapters.
- Hosting configuration exists for Cloudflare Pages (`wrangler.jsonc`) and Vercel (`vercel.json`).
- Cloudflare Pages build output is `dist`; Pages Functions are present.
- The local AI helper is explicitly documented as deterministic/rule-based and works without API keys. It must not be presented as a connected language model or real market research.
- An optional server-side generation path exists and the README documents OpenAI environment variables. A separate Cloudflare Workers AI path is also represented in an open PR.
- The control center reads a project registry and uses browser caching for public GitHub status data.

## Live GitHub state observed during audit

- Open PR #17, `feature/cloudflare-workers-ai` → `main`: reference-site analysis and optional Workers AI path; mergeable. PR description says full Node test suite and real Cloudflare Preview were not yet run.
- Open PR #14, `feature/autopilot-in-editor` → `feature/unique-design-architecture`: fixes same-niche repeat generation and draft settings; mergeable, but it targets a feature branch rather than `main`. Do not retarget or merge until its base dependency is understood.
- Recent `main` deployment workflow runs observed as successful. Project health monitor runs also succeeded.
- Current production deployment URL and branch must be confirmed in hosting before any release changes.

## Free-first assessment

### Already aligned
- Static app and static generated sites can be hosted on free static hosting tiers, subject to provider quotas.
- Local helper and browser-based project data do not require AI API credentials.
- Existing tests cover the control center, local bridge, studio home and UDS integration.
- The project registry is a small JSON file rather than a required remote database.

### Risks / work to verify
1. Map every server/API route and classify it as core-required, optional AI, or optional hosting integration.
2. Ensure the dashboard, local helper, project registry, editor and export work when all AI endpoints are unavailable.
3. Check that missing Workers AI binding, missing OpenAI key, provider errors and quota exhaustion produce graceful messages without blocking local work.
4. Review browser storage limits, export/import, backup and privacy behaviour.
5. Verify forms: static sites can open email/phone/messenger links, but durable submissions, notifications and CRM require a separately chosen service or backend.
6. Check that the UDS vendor bundle matches a known upstream commit and is reproducibly generated.
7. Confirm scheduled GitHub monitoring uses public data and does not require personal access tokens or paid services.

## Optimization sequence

1. Baseline: run the complete Node test suite and Cloudflare Pages build from a clean checkout.
2. Free-mode hardening: make AI unavailable by default and keep local generation/export fully operational.
3. Provider isolation: define an optional provider interface (Cloudflare Workers AI / other provider) outside the local core; no automatic paid fallback.
4. Integration: pin UDS engine commit/version and automate bundle sync plus compatibility tests.
5. Site operations: validate project registry, deploy status, static SEO/responsive/forms/security checks and graceful rate-limit handling.
6. Privacy/security: inspect endpoints, CORS/host allowlists, URL fetching protections, user data persistence and secret handling.
7. Release: preview deployment first; production only after explicit review and verified checks.

## Acceptance criteria

- Dashboard, local helper, editor, project registry and static export work with AI endpoints disabled.
- No paid API key is required for core workflows; no automatic switch to a paid provider.
- Cloudflare Pages build and all tests pass.
- UDS integration is reproducible and reports its upstream commit.
- Missing optional services do not break the app or generated sites.
- Forms and external service dependencies are labelled honestly.
- No production branch or deployment is changed without a reviewed release step.

## Audit status

Baseline created on `chore/free-first-audit`. This is a planning/audit artifact, not a claim that all checks above have already passed.
