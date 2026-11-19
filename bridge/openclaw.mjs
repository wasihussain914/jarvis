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

YOUR AGENT. You can reach ${NAME}, the user's personal AI agent, with the ask_agent tool. ${NAME} knows the user (memory, preferences, history) and can use their calendar, email, to-do list, notes and files. For anything personal — schedule, mail, tasks, reminders, "what did I…", anything about the user's life or work — call ask_agent with the request in plain words instead of guessing. Say a quick "One moment, sir" first if you like, since it can take a little while. Then speak ${NAME}'s answer briefly in your own voice. Answer general questions yourself.`

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
        { request: z.string().describe('What to ask or tell the agent, in full') },
        async ({ request }) => {
          try {
            const res = await fetch(`${URL_}/v1/chat/completions`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
                ...(MODEL ? { 'x-openclaw-model': MODEL } : {}),
              },
              body: JSON.stringify({
                model: 'openclaw/default',
                user: SESSION,
                messages: [{
                  role: 'user',
                  content: `[Spoken to you through the JARVIS voice interface; your reply will be read aloud, so keep it short and plain — no tables or markdown.]\n\n${request}`,
                }],
              }),
              signal: AbortSignal.timeout(180_000),
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
