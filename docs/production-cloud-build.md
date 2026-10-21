# Production cloud builds

`.github/workflows/production-cloud-build.yml` runs for pushes and pull requests
on `main`, `develop`, and `feature/copilot-multimodal-phase2d`, plus manual runs.
It verifies both applications, replays the canonical migrations and five SQL
regressions in disposable PostgreSQL 17.6, then builds the root Dockerfile in
GitHub Actions. No local Docker daemon, PostgreSQL volume, or database secret is
used. The resulting image tar is retained as a workflow artifact for three days;
this workflow does not publish or deploy it automatically.

The public repository's `ubuntu-24.04` runner has 16 GB RAM. Private repositories
must set the `PRODUCTION_BUILD_RUNNER` repository variable to an available
GitHub-hosted larger-runner label with at least 16 GB. The build verifies memory
before starting. `actions/setup-node` caches npm tarballs in `~/.npm`, keyed by
both lockfiles. Installs use `npm ci`, bounded sockets, and retry/backoff settings.
BuildKit separately caches image layers; neither cache includes local DB volumes.

## Vercel project configuration

The repository-root `vercel.json` installs and builds `frontend`, then serves
`frontend/dist`. For this configuration, select the repository root by clearing
the Vercel project's **Settings > Build and Deployment > Root Directory** field.
Root Directory is a project setting, not a supported `vercel.json` key. The
existing API rewrite is preserved. `frontend/vercel.json` also supports projects
explicitly rooted at `frontend` when that directory exists in the deployed ref.

At inspection, `origin/main` was `57f4151` and had no `frontend` directory or
backend package manifest. Changing Vercel's Root Directory alone cannot turn
that historical branch into this application. Merge the reviewed application
branch and these build configurations into main before deploying main. Do not
add an empty frontend directory or substitute a placeholder production app.

The saved Vercel CLI login returned HTTP 403 during project inspection. The
remote Root Directory setting and a successful deployment therefore remain
unverified until an authorized Vercel session is available. Repository changes
take effect in cloud CI only after they are pushed to a triggering ref.
