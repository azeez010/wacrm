// Writes src/lib/changelog.generated.json from git commits with a `Changelog:` trailer.
// Runs before every build (see package.json). Without git (e.g. a tarball build) the
// committed file is kept as is.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseGitLog } from './changelog-parse.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'src', 'lib', 'changelog.generated.json')

let raw
try {
  raw = execFileSync('git', ['log', '--no-merges', '--date=short', '--format=%ad%x1f%s%x1f%b%x1e'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch {
  console.log('changelog: git not available, keeping the committed file')
  process.exit(0)
}
const entries = parseGitLog(raw)
writeFileSync(out, JSON.stringify(entries, null, 2) + '\n')
console.log(`changelog: ${entries.reduce((n, e) => n + e.changes.length, 0)} entries from git`)
