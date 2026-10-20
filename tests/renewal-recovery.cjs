// Independent protocol regression: production functions, synthetic credentials and in-memory I/O only.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript')
function runtime(provider) {
  let now = 1800000000000, fail = '', hold = null, posts = 0, writes = 0
  const key = provider === 'Codex' ? 'ai_usage_official_oauth_v1' : 'ai_usage_claude_oauth_v1'
  const kc = new Map(), store = new Map()
  const token = (expires = now + 7200000) => 'fixture.' + Buffer.from(JSON.stringify({ sub: 'user', email: 'fixture@example.test', exp: expires / 1000, 'https://api.openai.com/auth': { chatgpt_account_id: 'account', chatgpt_user_id: 'user' } })).toString('base64url') + '.fixture'
  const initial = { id: provider === 'Codex' ? 'official-fixture' : 'claude:account:org', accountId: 'account', subject: 'user', organizationId: 'org', name: 'Fixture', email: 'fixture@example.test', access: provider === 'Codex' ? token() : 'fixture-access-old', refresh: 'fixture-refresh-old', expiresAt: now - 1, scope: 'user:profile', metadata: { preserve: true } }
  kc.set(key, JSON.stringify([initial]))
  const context = vm.createContext({ Map, Set, Math, Promise, console,
    Date: class extends Date { static now() { return now } }, clearTimeout: () => {},
    Data: { fromBase64String: s => ({ toRawString: () => Buffer.from(s, 'base64').toString() }) },
    Storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
    Keychain: { get: k => kc.get(k) ?? null, set: (k, v) => { if (k === key) { writes++; if (fail === 'false') return false; if (fail === 'throw') throw Error('SECRET-native-keychain'); } kc.set(k, v); return true }, remove: k => kc.delete(k) },
    fetch: async (url, options) => {
      if (url.endsWith('/oauth/token')) {
        posts++
        const body = JSON.parse(options.body)
        assert.equal(options.headers['Content-Type'], 'application/json')
        if (provider === 'Claude') { assert.equal(options.headers.Accept, 'application/json'); assert.equal(options.headers['User-Agent'], `ai-usage/${api.VERSION}`); assert.equal(body.scope, 'user:profile') }
        else assert.deepEqual(Object.keys(options.headers), ['Content-Type'])
        assert.equal(body.grant_type, 'refresh_token'); assert.equal(body.refresh_token, 'fixture-refresh-old')
        if (hold) await hold
        return { status: 200, json: async () => ({ access_token: provider === 'Codex' ? token() : 'fixture-access-new', refresh_token: 'fixture-refresh-rotated', expires_in: 7200 }) }
      }
      if (url.endsWith('/profile')) return { status: 200, json: async () => ({ account: { uuid: 'account', email: 'fixture@example.test' }, organization: { uuid: 'org' } }) }
      throw Error('unexpected fixture request')
    },
  })
  // Test hooks expose existing private functions; no production exports or protocol substitutes.
  const source = fs.readFileSync(path.join(__dirname, '../api.ts'), 'utf8').replace('async function refresh(item: Credential, force = false)', 'export async function refresh(item: Credential, force = false)') + '\nexport { refreshToken, saveOfficialCredential, ClaudeOAuth }'
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true })
  assert.equal(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  const m = { exports: {} }; vm.runInContext(`(function(exports,module){${compiled.outputText}\n})`, context)(m.exports, m)
  const api = m.exports
  api.saveSource('official')
  const saved = () => JSON.parse(kc.get(key) || '[]')[0]
  const renew = (item = saved(), force = false) => provider === 'Codex' ? api.refreshToken(item, force) : api.ClaudeOAuth.refresh(item, force)
  const login = async () => {
    if (provider === 'Codex') api.saveOfficialCredential({ access_token: token(), refresh_token: 'fixture-login-new' })
    else {
      // Finish through the real save branch, with a synthetic local response for this authorization only.
      const fetch = context.fetch
      context.fetch = async url => url.endsWith('/oauth/token') ? { status: 200, json: async () => ({ access_token: 'fixture-login-new', refresh_token: 'fixture-login-new', expires_in: 7200, scope: 'user:profile' }) } : fetch(url)
      await api.finishClaudeLogin({ code: 'fixture-code', state: 'fixture-state', verifier: 'fixture-verifier', redirect: 'http://localhost:8080/callback', expiresAt: now + 60000, manual: false, consumed: false, cancelled: false, server: null, timer: null, progress: '' })
      context.fetch = fetch
    }
  }
  return { api, kc, store, key, saved, renew, login, initial, stats: () => ({ posts, writes }), fail: v => { fail = v }, advance: ms => { now += ms }, hold: () => { let release; hold = new Promise(r => { release = r }); return release } }
}
async function main() {
  for (const provider of ['Codex', 'Claude']) {
    for (const failure of ['false', 'throw']) {
      const r = runtime(provider); r.fail(failure)
      for (let i = 0; i < 3; i++) await assert.rejects(r.renew(), e => /保存失败/.test(e.message) && !e.message.includes('SECRET'))
      assert.equal(r.stats().posts, 1, 'retry saving, never replay the consumed refresh token')
      assert.equal(r.saved().refresh, 'fixture-refresh-old')
      assert.ok(!JSON.stringify([...r.store]).includes('fixture-refresh'), 'no candidate in Storage')
      r.api.saveSource('official'); r.fail(''); const results = await Promise.all([r.renew(r.saved(), true), r.renew(), r.renew()])
      assert.ok(results.every(c => c.refresh === 'fixture-refresh-rotated')); assert.equal(r.stats().posts, 1)
      assert.equal(r.saved().refresh, 'fixture-refresh-rotated'); assert.deepEqual(r.saved().metadata, { preserve: true })
    }
    {
      const r = runtime(provider); r.fail('false'); await assert.rejects(r.renew()); r.advance(7200001); r.fail('')
      for (let i = 0; i < 2; i++) await assert.rejects(r.renew(), /已过期/)
      assert.equal(r.stats().posts, 1); assert.equal(r.saved().refresh, 'fixture-refresh-old')
    }
    {
      const r = runtime(provider), release = r.hold(); const a = r.renew(), b = r.renew(); release()
      await Promise.all([a, b]); assert.equal(r.stats().posts, 1)
    }
    for (const changed of ['source', 'credential', 'logout', 'login']) {
      const r = runtime(provider); r.fail('false'); await assert.rejects(r.renew()); r.fail('')
      if (changed === 'source') { r.api.saveSource('parrot'); r.api.saveSource('official'); await r.renew(); assert.equal(r.stats().posts, 2, 'source switch invalidates candidate') }
      if (changed === 'credential') { const next = { ...r.saved(), refresh: 'fixture-other-refresh', access: 'fixture-other-access', expiresAt: 1800010000000 }; r.kc.set(r.key, JSON.stringify([next])); const got = await r.renew(r.initial); assert.equal(got.refresh, next.refresh); assert.equal(r.stats().posts, 1) }
      if (changed === 'logout') { r.api.logoutOfficial(r.initial.id); await assert.rejects(r.renew(r.initial), /已退出/); assert.equal(r.saved(), undefined); assert.equal(r.stats().posts, 1) }
      if (changed === 'login') { await r.login(); const got = await r.renew(r.initial); assert.equal(got.refresh, 'fixture-login-new'); assert.equal(r.stats().posts, 1) }
    }
    // Changing credentials while the original response is delayed must win over the old job.
    for (const changed of ['source', 'credential', 'logout', 'login']) {
      const r = runtime(provider), release = r.hold(), job = r.renew()
      if (changed === 'source') { r.api.saveSource('parrot'); r.api.saveSource('official') }
      if (changed === 'credential') r.kc.set(r.key, JSON.stringify([{ ...r.saved(), refresh: 'fixture-other-refresh', access: 'fixture-other-access', expiresAt: 1800010000000 }]))
      if (changed === 'logout') r.api.logoutOfficial(r.initial.id)
      if (changed === 'login') await r.login()
      release()
      if (changed === 'logout') { await assert.rejects(job, /已退出/); assert.equal(r.saved(), undefined) }
      else if (changed === 'source') { await assert.rejects(job, /已改变/); assert.equal(r.saved().refresh, 'fixture-refresh-old') }
      else { await job; assert.equal(r.saved().refresh, changed === 'credential' ? 'fixture-other-refresh' : 'fixture-login-new') }
      assert.equal(r.stats().posts, 1)
    }
    console.log(`PASS ${provider}: false/throw + repeated save-only recovery, secret-safe error, expiration/no replay, concurrent singleflight, source/credential/logout/relogin invalidation and delayed-response protection; exact renewal headers/scope retained`)
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
