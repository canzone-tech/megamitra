# MegaGoldenClub Development and Delivery Rules

**Applies to all subsequent changes.** This document defines the
repeatable GitHub-to-local-to-production handoff established after the
2026-10-14 production update. It is a workflow policy, **not** a new
business-rule approval or a blanket production authorization. The
[Business Rules Register](BUSINESS-RULES-REGISTER.md) remains canonical for
product decisions, and the [Production Runbook](PRODUCTION-RUNBOOK.md)
governs detailed release operations.

## Reliable local verification process lifecycle

The canonical root `npm run verify` must not hang after an authenticated UAT fixture prints its cleanup message. Its fixture process starts only scoped Config/Prisma/JWT/password providers, verifies shutdown before reporting completion, and explicitly exits. Both UAT create and cleanup use strict bounded timeouts with escalation; `Ctrl+C` returns a nonzero exit after cleanup and must never silently resume verification. Hang/interrupt outputs are FAILED until the root command actually reports PASS and returns to the terminal. Do not suggest killing unrelated services or manual source edits.

## GitHub-first change process

1. Use the MegaGoldenClub GitHub repository, branch
   `dev/local-foundation`. Preserve existing work and use normal
   non-force commits. Do not edit `main` or other projects as a shortcut.
2. Investigate the reported bug, modify code, tests, and relevant docs
   **in the GitHub repository**, and push the fix. Do not give manual local
   patches or ask the operator to edit files unless expressly requested.
3. Recheck repository script execute bits (especially
   `backend/scripts/verify-local.sh`) and let
   `scripts/verify-script-modes.mjs` catch regression. Never use a local
   `chmod` as the permanent repository fix.
4. If a GitHub workflow fails, inspect the specific job/step, fix the
   repository issue, push a new commit and repeat all gates. Do not treat
   older successful runs as evidence for the new commit.

## Release candidate verification

The **same exact commit SHA** must have:

- **Backend CI**: success, including regression, runtime package and UAT.
- **Frontend CI**: success, covering Admin and Member builds.
- **Release Evidence**: success tied to the same Backend/Frontend runs.

Only after these three gates succeed should the operator be asked to run
the following on their own **local development machine**, from repo root:

```bash
git pull
npm run verify
```

`npm run verify` is the **authoritative local verification gate**.
Do not replace it with selected unit tests, assume success, or instruct
the operator to run it on the VPS. If it fails, fix the issue in GitHub,
push, confirm all three CI gates again and repeat the local pull/verify.

## Production approval and safety

- **No automatic rollout.** A code-ready candidate is not deployed.
  Obtain explicit operator approval for the specific production release.
  The operator confirms real encrypted off-host backups and a tested
  isolated restore; CI's simulated restore is **not** that evidence.
  Record human release/recovery approval and any unresolved gate.
- Deploy only a CI-built, **source-free**, immutable runtime artifact
  identified by its own exact `RELEASE_SHA`. Verify outer CI artifact
  SHA256 (if used), the packaged archive checksum, and embedded SHA.
  Do not confuse the application runtime SHA with a later commit that
  updates only deployment tooling.
- Prefer the reviewed GitHub runtime release. If GitHub denies release
  creation (including a 403 despite `Contents: write`), the pinned
  successful Backend CI artifact may be transferred to the target directly
  and checked by `infra/ubuntu-vps/deploy-reviewed-update.sh` with
  `--uploaded-zip`. Do **not** weaken exact-SHA verification, grant
  unnecessary permissions, expose a PAT on the VPS, or install source
  checkout, build dependencies, test containers or migrations there.
- On the shared Ubuntu VPS, keep the existing unrelated sites and
  processes unchanged. Use only the dedicated non-root
  `megagoldenclub` PM2 namespace and ports
  `127.0.0.1:3200` (API), `3201` (Admin), `3202` (Member).
  Verify live deployment is the expected old SHA and healthy **before**
  switching. Retain that compiled release for rollback. Restart only
  the three dedicated apps; verify readiness afterwards and attempt
  scoped rollback if the new release fails.
- No data migrations, finance activation, Apache edits, PM2 daemon reset,
  or unrelated service changes are implied by a normal code-only release.
  Migration or infrastructure changes require a separate reviewed plan.

## Required production smoke evidence

The operator or authorized external checker must capture:

| Surface | Expected result |
| --- | --- |
| `https://megagoldenclub.com/` | Valid TLS, redirect to HTTPS www, healthy public page |
| `https://www.megagoldenclub.com/` | Valid TLS, HTTP 200 |
| `https://admin.megagoldenclub.com/` | Valid TLS, login redirect and HTTP 200 |
| `https://api.megagoldenclub.com/auth/public-config` | Valid TLS, HTTP 200 |
| `https://api.megagoldenclub.com/admin/users` (no token) | Valid TLS, HTTP 401 |
| Public `https://api.megagoldenclub.com/health/live` and `/health/ready` | **HTTP 404, intentionally blocked by Apache** |
| VPS localhost `http://127.0.0.1:3200/health/ready` | HTTP 200, `status: ok`, MySQL/MongoDB/Redis all `up` |
| VPS local Admin `3201` and Member `3202` | Healthy 2xx or expected login redirect |
| Dedicated PM2 and `/opt/megagoldenclub/current` | Exactly the intended running runtime SHA; other sites/processes unchanged |

For changes to notifications or UI interactions, also require a **real
production visual test** of the affected workflow: e.g., Prize Catalogue
save shows the readable floating success toast while scrolled. Error
notification behavior and other modules are not verified simply because
one success toast was seen.

## Non-negotiable HOLD boundaries

Financial/payout operations remain **HOLD** without separate approval,
provider/operator UAT and off-host recovery sign-off. The unrelated
on-hold project and its VPS processes must never be modified as part of
MegaGoldenClub work. The business owner's outstanding product-rule
decisions remain open until explicitly approved; code/CI cannot waive
these holds.

## Evidence from the 2026-10-14 update (historical, not evergreen)

The operator reported root `npm run verify` green. The runtime at
`5cc5b98f4b45e40d38906a153aafcbb3e2b28a70` was installed on the
VPS using reviewed ops tooling at
`bad6a2617c367ee2da8c3b3afee54ab64022a71d`. The VPS command
reported checksum validation, isolated dedicated PM2 activation,
post-switch health and new `current` release SHA as PASS; the prior
`ba4750b6bf0880ebb8b3a76c6af3bc14acb8e4a4` release was preserved.
External curl results from the operator confirmed www and Admin HTTP
200/TLS 0, public config HTTP 200/TLS 0, protected users HTTP 401/TLS 0,
and intentionally blocked public health HTTP 404. The operator supplied
a production Admin Prize Catalogue screenshot showing the floating
success message. This is **specific evidence for that release**, not a
claim about all features, future releases, finance enablement, or the
status of external operational sign-off documents.

For every subsequent release, repeat the gates and report clearly:
**GitHub CI status → local root verify status → explicit release approval
→ VPS activation → external API/TLS smoke → relevant human visual UAT**.
