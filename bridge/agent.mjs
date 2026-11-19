import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * Bring your own agent.
 *
 * JARVIS is a fast voice. Your personal agent — OpenClaw, or anything else
 * that speaks the OpenAI chat-completions protocol — is the one with your
 * memory, accounts and tools. Point JARVIS at it and he gets one tool,
 * `ask_agent`, that hands personal or actionable requests over and reads the
 * answer back.
 *
 *   JARVIS_AGENT_URL         base URL of the agent's API (required), e.g.
 *                            http://127.0.0.1:18789 for a local OpenClaw gateway
 *   JARVIS_AGENT_TOKEN       bearer token for it (required)
 *   JARVIS_AGENT_NAME        what JARVIS calls it, e.g. "Chopper" (default "your agent")
 *   JARVIS_AGENT_MODEL       `model` sent in the request (default "openclaw/default")
 *   JARVIS_AGENT_SESSION     conversation id, so voice turns share one thread
 *                            kept apart from your other chats (default "jarvis-voice")
 *   JARVIS_AGENT_FAST_MODEL  OpenClaw only: run quick look-ups on this model via
 *                            the x-openclaw-model header (e.g. anthropic/claude-haiku-4-5).
 *                            "Heavy" requests always use the agent's own model.
 *
 * The JARVIS_OPENCLAW_* names from the first version are still read.
 *
 * The token usually grants full control of the agent. Keep the agent on the
 * same machine or a private network (Tailscale, WireGuard); never expose its
 * API to the internet so a voice UI can reach it.
 */
export function agentConfig(env = process.env) {
  const pick = (name) => (env[`JARVIS_AGENT_${name}`] ?? env[`JARVIS_OPENCLAW_${name}`] ?? '').trim()
  return {
    url: pick('URL').replace(/\/+$/, ''),
    token: pick('TOKEN'),
    name: pick('NAME') || 'your agent',
    // Not pick(): the first version's JARVIS_OPENCLAW_MODEL meant the fast model.
    model: (env.JARVIS_AGENT_MODEL ?? '').trim() || 'openclaw/default',
    session: pick('SESSION') || 'jarvis-voice',
    // The first version called the fast model JARVIS_OPENCLAW_MODEL.
    fastModel: (env.JARVIS_AGENT_FAST_MODEL ?? env.JARVIS_OPENCLAW_MODEL ?? '').trim(),
  }
}

export const agentConfigured = (cfg = agentConfig()) => Boolean(cfg.url && cfg.token)

/** What the agent is told about the channel it is being reached through. */
export const VOICE_PREAMBLE =
  '[Spoken to you through the JARVIS voice interface. Use your memory and tools as you ' +
  "normally would — including your browser sessions and account access — rather than saying you can't. " +
  'Your reply will be read aloud, so keep the final answer short and plain, no tables or markdown.]'

/**
 * One request to the agent. Returns its reply text; throws on failure.
 * Exported on its own so it can be tested without the MCP machinery.
 */
export async function callAgent(cfg, request, { heavy = false, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${cfg.url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      ...(cfg.fastModel && !heavy ? { 'x-openclaw-model': cfg.fastModel } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      user: cfg.session,
      messages: [{ role: 'user', content: `${VOICE_PREAMBLE}\n\n${request}` }],
    }),
    // Heavy work (logging in somewhere, browsing) can take minutes.
    signal: AbortSignal.timeout(heavy ? 600_000 : 180_000),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.error?.message ?? ''
    } catch {}
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || '(no reply)'
}

export const agentPrompt = (cfg = agentConfig()) => `

YOUR AGENT — READ CAREFULLY. You are the voice of ${cfg.name}, the user's personal AI agent, reached with the ask_agent tool. ${cfg.name} has long-term memory of the user and can act for them: calendar, email, to-do list, notes, files, school and work sites, logins it has been given, web browsing, scheduling, research and more.
- Call ask_agent for ANYTHING about the user or their life, ANY request to do, check, open, log in to, look up, remember or change something, and anything you are not sure you can answer from general knowledge. When in doubt, ask ${cfg.name}.
- Never refuse a request yourself and never say you lack memory, credentials, accounts or access. Those belong to ${cfg.name}, not you — pass the request on and let ${cfg.name} decide.
- Answer on your own only for small talk and simple general-knowledge questions.
- Set heavy=true whenever ${cfg.name} must go and do something (open or log in to a site, check mail, change the calendar, anything multi-step); it takes longer, so tell the user "On it, sir, this may take a minute." Leave heavy off for quick questions about what ${cfg.name} already knows.
- Pass the request in the user's own words plus any context from this conversation, then speak ${cfg.name}'s answer briefly in your own voice.`

export function agentServer(cfg = agentConfig()) {
  return createSdkMcpServer({
    name: 'agent',
    version: '1.0.0',
    instructions: `Hand personal and actionable requests to ${cfg.name}, the user's own agent.`,
    alwaysLoad: true,
    tools: [
      tool(
        'ask_agent',
        `Ask ${cfg.name} (the user's personal agent, with their memory, calendar, email, to-dos, files and accounts) to answer or do something. Pass the full request in plain words. Returns the agent's reply.`,
        {
          request: z.string().describe('What to ask or tell the agent, in full'),
          heavy: z.boolean().optional().describe(
            'true when the agent has to go and DO something: log in to or browse a site, read or send mail, change the calendar, multi-step work. Slower but far more capable. false/omitted for quick recall of what it already knows.',
          ),
        },
        async ({ request, heavy }) => {
          try {
            const text = await callAgent(cfg, request, { heavy })
            return { content: [{ type: 'text', text }] }
          } catch (err) {
            return {
              content: [{ type: 'text', text: `${cfg.name} could not be reached: ${err.message}` }],
              isError: true,
            }
          }
        },
      ),
    ],
  })
}
