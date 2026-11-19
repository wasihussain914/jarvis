import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * An OpenClaw agent as JARVIS's back office.
 *
 * Set JARVIS_OPENCLAW_URL (the gateway, e.g. http://127.0.0.1:18789) and
 * JARVIS_OPENCLAW_TOKEN, and JARVIS gets one tool, `ask_agent`, that hands a
 * request to that agent over the gateway's OpenAI-compatible endpoint. The
 * agent has its own memory and tools (calendar, mail, to-dos, files), so
 * JARVIS stays the fast voice and the agent does the real work. All voice
 * turns share one session (JARVIS_OPENCLAW_SESSION, default "jarvis-voice"),
 * kept apart from the agent's other chats.
 *
 * The token is an owner-level credential for that gateway: only point this at
 * a gateway on the same machine or a private network.
 */
const URL_ = process.env.JARVIS_OPENCLAW_URL?.trim().replace(/\/+$/, '')
const TOKEN = process.env.JARVIS_OPENCLAW_TOKEN?.trim()
const SESSION = process.env.JARVIS_OPENCLAW_SESSION?.trim() || 'jarvis-voice'
const NAME = process.env.JARVIS_OPENCLAW_NAME?.trim() || 'your agent'
// Optional model override for the agent's voice turns (e.g. anthropic/claude-haiku-4-5
// for speed). Must be in the agent's allowed models. Unset = the agent's own model.
const MODEL = process.env.JARVIS_OPENCLAW_MODEL?.trim()

export const openclawConfigured = () => Boolean(URL_ && TOKEN)

export const PROMPT_AGENT = () => `

YOUR AGENT — READ CAREFULLY. You are the voice of ${NAME}, the user's personal AI agent, reached with the ask_agent tool. ${NAME} has long-term memory of the user and can act for them: calendar, email, to-do list, notes, files, school sites like Brightspace, logins it has been given, web browsing, scheduling, research and more.
- Call ask_agent for ANYTHING about the user or their life, ANY request to do, check, open, log in to, look up, remember or change something, and anything you are not sure you can answer from general knowledge. When in doubt, ask ${NAME}.
- Never refuse a request yourself and never say you lack memory, credentials, accounts or access. Those belong to ${NAME}, not you — pass the request on and let ${NAME} decide.
- Answer on your own only for small talk and simple general-knowledge questions.
- Set heavy=true whenever ${NAME} must go and do something (open or log in to a site like Brightspace, check mail, change the calendar, anything multi-step); it takes longer, so tell the user "On it, sir, this may take a minute." Leave heavy off for quick questions about what ${NAME} already knows.
- Pass the request in the user's own words plus any context from this conversation. Say "One moment, sir" first if it may take a while, then speak ${NAME}'s answer briefly in your own voice.`

export function openclawServer() {
  return createSdkMcpServer({
    name: 'openclaw',
    version: '1.0.0',
    instructions: `Hand personal requests to ${NAME}, the user's own agent.`,
    alwaysLoad: true,
    tools: [
      tool(
        'ask_agent',
        `Ask ${NAME} (the user's personal agent, with their memory, calendar, email, to-dos and files) to answer or do something. Pass the full request in plain words. Returns the agent's reply.`,
        {
          request: z.string().describe('What to ask or tell the agent, in full'),
          heavy: z.boolean().optional().describe(
            'true when the agent has to go and DO something: log in to or browse a site (e.g. Brightspace), read or send mail, change the calendar, multi-step work. Slower but far more capable. false/omitted for quick recall of what it already knows.',
          ),
        },
        async ({ request, heavy }) => {
          try {
            const res = await fetch(`${URL_}/v1/chat/completions`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
                ...(MODEL && !heavy ? { 'x-openclaw-model': MODEL } : {}),
              },
              body: JSON.stringify({
                model: 'openclaw/default',
                user: SESSION,
                messages: [{
                  role: 'user',
                  content: `[Spoken to you through the JARVIS voice interface. Use your memory and tools as you normally would — including your browser sessions and account access — rather than saying you can't. Your reply will be read aloud, so keep the final answer short and plain, no tables or markdown.]\n\n${request}`,
                }],
              }),
              signal: AbortSignal.timeout(heavy ? 600_000 : 180_000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            const text = data.choices?.[0]?.message?.content?.trim() || '(no reply)'
            return { content: [{ type: 'text', text }] }
          } catch (err) {
            return { content: [{ type: 'text', text: `${NAME} could not be reached: ${err.message}` }], isError: true }
          }
        },
      ),
    ],
  })
}
