# Connect your own agent

JARVIS is a fast voice. Your personal agent is the one with your memory, accounts and tools. Connect them and JARVIS answers small talk himself, then hands anything personal or actionable ("what's on my calendar", "check Brightspace", "add milk to my list") to your agent and reads its answer back.

It works with any agent that speaks the **OpenAI chat-completions API** (`POST /v1/chat/completions`). [OpenClaw](https://github.com/openclaw/openclaw) supports it out of the box; so do LiteLLM, vLLM, Ollama and most self-hosted agents.

```
 you ──voice──▶ JARVIS (browser) ──▶ bridge ──ask_agent──▶ your agent ──▶ calendar, mail, files…
                                       │
                                       └─ small talk handled by JARVIS's own model
```

## OpenClaw in 4 steps

**1. Turn on the gateway's chat endpoint** (off by default):

```bash
openclaw config set gateway.http.endpoints.chatCompletions.enabled true
openclaw gateway restart
```

**2. Get the gateway token.** `openclaw config get` hides secrets, so read it from the config file:

```bash
python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.openclaw/openclaw.json')))['gateway']['auth']['token'])"
```

**3. Point the bridge at it.** In the shell that runs `npm run bridge` (or in `.env.local`):

```bash
JARVIS_AGENT_URL=http://127.0.0.1:18789
JARVIS_AGENT_TOKEN=<token from step 2>
JARVIS_AGENT_NAME=Chopper          # whatever you call your agent
```

**4. Start JARVIS** (`npm start`). The bridge prints `[jarvis] agent Chopper at http://127.0.0.1:18789`. Ask "what's on my calendar tomorrow?" and you should see `tool mcp__agent__ask_agent -> allow` in the bridge log.

Voice turns go to one dedicated conversation (`jarvis-voice`), kept apart from your other chats with the agent.

### Optional: fast look-ups

A big model with your whole workspace loaded can take a while to reply. OpenClaw can run JARVIS's quick questions on a smaller model and keep the big one for real work:

```bash
JARVIS_AGENT_FAST_MODEL=anthropic/claude-haiku-4-5
```

The model must be on your agent's allowlist (`agents.defaults.models` in `~/.openclaw/openclaw.json`). If it is not, the bridge log shows `Model '…' is not allowed for agent '…'`. JARVIS decides per request: quick recall goes to the fast model, and anything where the agent has to *do* something (log in somewhere, browse, send, change the calendar) is marked `heavy` and runs on the agent's normal model.

## Other agents

Anything OpenAI-compatible works. Set `JARVIS_AGENT_MODEL` to the model or agent id your server expects:

```bash
JARVIS_AGENT_URL=http://localhost:4000      # e.g. a LiteLLM proxy in front of your agent
JARVIS_AGENT_TOKEN=sk-...
JARVIS_AGENT_MODEL=my-agent
```

The request is a plain chat completion: one user message, plus `user: "jarvis-voice"` so servers that keep sessions can tie voice turns together. `JARVIS_AGENT_FAST_MODEL` sends OpenClaw's `x-openclaw-model` header, which other servers ignore.

## All settings

| Variable | Default | Effect |
|---|---|---|
| `JARVIS_AGENT_URL` | none | Agent API base URL. Required to enable the connector |
| `JARVIS_AGENT_TOKEN` | none | Bearer token. Required |
| `JARVIS_AGENT_NAME` | `your agent` | The name JARVIS uses for it |
| `JARVIS_AGENT_MODEL` | `openclaw/default` | `model` field in the request |
| `JARVIS_AGENT_SESSION` | `jarvis-voice` | Conversation id sent as `user` |
| `JARVIS_AGENT_FAST_MODEL` | none | OpenClaw only: model for quick look-ups |

## Security

- **The token is a master key.** For OpenClaw it grants full operator access to the gateway. Keep it in your shell or `.env.local` (gitignored). Never put it in a `VITE_` variable, because those ship to the browser.
- **Keep the agent private.** Run JARVIS on the same machine as the agent, or reach the agent over Tailscale or WireGuard. Never open the agent's port to the internet just so a voice UI can reach it.
- **If JARVIS itself is reachable from outside** (for example on a server), put a password or SSO in front of it. Anyone who can talk to JARVIS can talk to your agent. `aws/` shows one way: Caddy with HTTPS and basic auth.
