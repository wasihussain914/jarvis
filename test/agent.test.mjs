// The bring-your-own-agent connector (bridge/agent.mjs), against a fake
// OpenAI-compatible agent on a local port.
//
//   node --test test/

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { agentConfig, agentConfigured, agentPrompt, callAgent, VOICE_PREAMBLE } from '../bridge/agent.mjs'
import { decideTool } from '../bridge/policy.mjs'

let server
let base
let last // the last request the fake agent received
let reply = { status: 200, body: { choices: [{ message: { content: ' Your first class is at eleven. ' } }] } }

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', () => {
      last = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null }
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply.body))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

test('config: unset means not configured', () => {
  assert.equal(agentConfigured(agentConfig({})), false)
  assert.equal(agentConfigured(agentConfig({ JARVIS_AGENT_URL: base })), false, 'token is required too')
})

test('config: defaults and trailing slash', () => {
  const cfg = agentConfig({ JARVIS_AGENT_URL: `${base}///`, JARVIS_AGENT_TOKEN: 't' })
  assert.equal(cfg.url, base)
  assert.equal(cfg.name, 'your agent')
  assert.equal(cfg.model, 'openclaw/default')
  assert.equal(cfg.session, 'jarvis-voice')
  assert.equal(cfg.fastModel, '')
  assert.ok(agentConfigured(cfg))
})

test('config: legacy JARVIS_OPENCLAW_* names still work', () => {
  const cfg = agentConfig({
    JARVIS_OPENCLAW_URL: base,
    JARVIS_OPENCLAW_TOKEN: 't',
    JARVIS_OPENCLAW_NAME: 'Chopper',
    JARVIS_OPENCLAW_MODEL: 'anthropic/claude-haiku-4-5',
  })
  assert.ok(agentConfigured(cfg))
  assert.equal(cfg.name, 'Chopper')
  assert.equal(cfg.fastModel, 'anthropic/claude-haiku-4-5', 'old MODEL meant the fast model')
  assert.equal(cfg.model, 'openclaw/default')
})

test('request: OpenAI chat-completions shape, bearer auth, stable session', async () => {
  const cfg = agentConfig({ JARVIS_AGENT_URL: base, JARVIS_AGENT_TOKEN: 'secret', JARVIS_AGENT_SESSION: 'voice-1' })
  const text = await callAgent(cfg, "what's my first class?")
  assert.equal(text, 'Your first class is at eleven.')
  assert.equal(last.method, 'POST')
  assert.equal(last.url, '/v1/chat/completions')
  assert.equal(last.headers.authorization, 'Bearer secret')
  assert.equal(last.body.model, 'openclaw/default')
  assert.equal(last.body.user, 'voice-1')
  assert.equal(last.body.messages.length, 1)
  assert.equal(last.body.messages[0].role, 'user')
  assert.ok(last.body.messages[0].content.startsWith(VOICE_PREAMBLE))
  assert.ok(last.body.messages[0].content.endsWith("what's my first class?"))
})

test('request: fast model only on quick look-ups, never on heavy work', async () => {
  const cfg = agentConfig({ JARVIS_AGENT_URL: base, JARVIS_AGENT_TOKEN: 't', JARVIS_AGENT_FAST_MODEL: 'anthropic/claude-haiku-4-5' })
  await callAgent(cfg, 'quick one')
  assert.equal(last.headers['x-openclaw-model'], 'anthropic/claude-haiku-4-5')
  await callAgent(cfg, 'log in to Brightspace', { heavy: true })
  assert.equal(last.headers['x-openclaw-model'], undefined)
})

test('request: no fast model configured sends no override header', async () => {
  const cfg = agentConfig({ JARVIS_AGENT_URL: base, JARVIS_AGENT_TOKEN: 't' })
  await callAgent(cfg, 'hi')
  assert.equal(last.headers['x-openclaw-model'], undefined)
})

test('errors: agent error message is surfaced', async () => {
  reply = { status: 400, body: { error: { message: "Model 'x' is not allowed for agent 'main'." } } }
  const cfg = agentConfig({ JARVIS_AGENT_URL: base, JARVIS_AGENT_TOKEN: 't' })
  await assert.rejects(callAgent(cfg, 'hi'), /HTTP 400: Model 'x' is not allowed/)
  reply = { status: 200, body: { choices: [] } }
  assert.equal(await callAgent(cfg, 'hi'), '(no reply)')
  reply = { status: 200, body: { choices: [{ message: { content: 'ok' } }] } }
})

test('errors: unreachable agent rejects', async () => {
  const cfg = agentConfig({ JARVIS_AGENT_URL: 'http://127.0.0.1:1', JARVIS_AGENT_TOKEN: 't' })
  await assert.rejects(callAgent(cfg, 'hi'))
})

test('prompt: names the agent and forbids refusing on its behalf', () => {
  const p = agentPrompt(agentConfig({ JARVIS_AGENT_URL: base, JARVIS_AGENT_TOKEN: 't', JARVIS_AGENT_NAME: 'Friday' }))
  assert.match(p, /Friday/)
  assert.match(p, /Never refuse/)
  assert.match(p, /heavy=true/)
})

test('policy: ask_agent is allowed without --writes; headless Playwright reads too', () => {
  assert.equal(decideTool('mcp__agent__ask_agent'), true)
  assert.equal(decideTool('mcp__playwright__browser_navigate'), true)
  assert.equal(decideTool('mcp__playwright__browser_snapshot'), true)
  assert.equal(decideTool('mcp__playwright__browser_click'), false, 'acting still needs --writes')
  assert.equal(decideTool('mcp__playwright__browser_type'), false)
  assert.equal(decideTool('mcp__playwright__browser_click', true), true)
})
