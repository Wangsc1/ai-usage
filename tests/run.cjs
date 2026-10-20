// Each suite runs in its own process; a failure never skips the remaining suites.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process')
try { require(process.env.TYPESCRIPT_PATH || 'typescript') }
catch { console.error('Install the pinned test dependency: npm install --prefix tests --ignore-scripts; or set TYPESCRIPT_PATH to an absolute TypeScript module path.'); process.exit(1) }
const suites = fs.readdirSync(__dirname).filter(f => f.endsWith('.cjs') && f !== 'run.cjs').sort()
let failed = 0
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`)
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit', env: process.env })
  if (result.error || result.status !== 0) { failed++; console.error(`FAIL ${suite}: ${result.error?.message || result.signal || result.status}`) }
}
console.log(`\n${suites.length - failed}/${suites.length} offline suites passed`)
process.exitCode = failed ? 1 : 0
