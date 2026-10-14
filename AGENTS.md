# MegaGoldenClub repository instructions (development and production)

These instructions apply to every future change in this repository. Read
[delivery rules](docs/DEVELOPMENT-DELIVERY-RULES.md),
[Business Rules Register](docs/BUSINESS-RULES-REGISTER.md), and the
[Production Runbook](docs/PRODUCTION-RUNBOOK.md) before modifying related behavior.

1. Work on `dev/local-foundation` by default. Make code/documentation fixes
   directly in this GitHub repository, commit and push without force-updating
   history. Do not give the operator manual source-file patches or ask them
   to edit source locally unless they explicitly request that workflow.
2. For **every new commit**, verify Backend CI, Frontend CI, and Release
   Evidence all succeeded against that **same exact SHA**. A failing or
   pending check is not a green release; fix in GitHub and re-run the gates.
3. After GitHub is green, ask the operator only to `git pull` and run the
   **repository-root** `npm run verify`. This is the authoritative local gate.
   Do not replace it with ad hoc tests or claim local green without their result.
4. Never deploy automatically because CI or local is green. Production
   deployment requires an explicit operator request, recovery/rollback
   sign-off and target-host preflight. Keep immutable, checksum-verified,
   compiled **source-free** releases separate from ops script commits.
5. The shared VPS uses the dedicated `megagoldenclub` user and its own
   PM2_HOME on localhost 3200/3201/3202. Do not change other applications,
   root PM2, their ports, Apache sites, databases or volumes. Retain the
   previous compatible compiled release and restore it on failed rollout.
6. Require production API readiness and external DNS/HTTPS smoke checks.
   Public `/health` and `/health/*` intentionally return 404 via Apache;
   `/auth/public-config` should return 200 and unauthenticated
   `/admin/users` should return 401. A successful login/real UI action
   needs separate operator visual UAT, not just an HTTP probe.
7. Financial operations and payouts remain **HOLD** unless separately
   reviewed, explicitly authorized and supported by operational recovery
   evidence. Do not modify or deploy the unrelated project on HOLD.
8. Never expose secrets in commits, logs, shell history, URLs or chat.
   Never run migrations, checkout application source or run `npm run verify`
   on the production runtime host.

Report exact repository SHA, three CI states, local verification,
production deployment status, smoke evidence and any remaining HOLD gate
separately. A previously successful release never authorizes the next one.
