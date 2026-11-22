@AGENTS.md

## Git remotes

- Push only to `fork` (github.com/azeez010/wacrm), branch `main`. Never push to `origin` (ArnasDon/wacrm, the open-source upstream); there is no write access there and it must never be attempted.
- `origin` is read-only: fetch from it and pull in specific features when the user asks (cherry-pick or merge selectively), then push the result to `fork`.
- If the target remote is ever ambiguous, ask before pushing.
