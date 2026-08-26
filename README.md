# checkpoint_traffic

Project repository for checkpoint traffic work.

## GitHub Actions

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/claude.yml` | `@claude` mentioned in an issue, PR comment or review | Runs Claude Code on the request |
| `.github/workflows/claude-code-review.yml` | PR opened / updated / reopened | Posts an automated inline code review |
| `.github/workflows/deploy-pages.yml` | Push to `main` touching `site/**` | Publishes `site/` to GitHub Pages |

Both Claude workflows need the repository secret `CLAUDE_CODE_OAUTH_TOKEN`,
which is created by installing the Claude GitHub App (`/install-github-app`
in Claude Code).

`deploy-pages.yml` only fires on pushes touching `site/**` — a README-only
commit will not produce a deploy run.
