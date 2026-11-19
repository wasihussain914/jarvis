import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * Job search over the SimplifyJobs lists — the community-maintained, daily
 * updated GitHub lists of tech internships and new-grad roles.
 *
 * The lists' README is ~800 KB of HTML tables, far more than a web fetch can
 * read, so this goes to the structured listings.json behind them and filters
 * locally. Enabled with JARVIS_JOBS=1 (the AWS deployment turns it on).
 */
const SOURCES = {
  internship: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json',
  newgrad: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
}

/** The lists have used both short and long names for the same categories. */
const CATEGORIES = {
  software: ['software', 'software engineering'],
  data: ['ai/ml/data', 'data science, ai & machine learning'],
  quant: ['quant', 'quantitative finance'],
  product: ['product', 'product management'],
  hardware: ['hardware', 'hardware engineering'],
}

/** The lists abbreviate the big hubs ("NYC", "SF"); match either way. */
const LOCATION_ALIASES = [
  ['new york', 'nyc'],
  ['san francisco', 'sf', 'bay area'],
  ['los angeles', 'la'],
  ['washington dc', 'washington, dc', 'dc'],
  ['remote', 'remote in'],
]

function locationTerms(loc) {
  const group = LOCATION_ALIASES.find((g) => g.some((a) => loc === a || loc.startsWith(a + ' ') || loc.includes(a) && a.length > 3))
  return group ? [...new Set([loc, ...group])] : [loc]
}

function locationMatches(locations, loc) {
  const terms = locationTerms(loc)
  return locations.some((l) => {
    const low = l.toLowerCase()
    // Short aliases ("sf", "la", "dc") must match a whole token, not a substring of "Dallas".
    return terms.some((t) => (t.length <= 3 ? low.split(/[^a-z]+/).includes(t) : low.includes(t)))
  })
}

export const jobsEnabled = (env = process.env) => env.JARVIS_JOBS === '1'

const CACHE_MS = 30 * 60 * 1000
const cache = new Map() // kind -> { at, rows }

async function load(kind, fetchImpl) {
  const hit = cache.get(kind)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows
  const res = await fetchImpl(SOURCES[kind], { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`job list HTTP ${res.status}`)
  const rows = await res.json()
  cache.set(kind, { at: Date.now(), rows })
  return rows
}

/** Pure filter, exported for tests. */
export function searchJobs(rows, { role = 'software', location = '', keyword = '', count = 5, now = Date.now() } = {}) {
  const cats = CATEGORIES[role] ?? null
  const loc = location.trim().toLowerCase()
  const kw = keyword.trim().toLowerCase()
  const n = Math.min(Math.max(1, count | 0 || 5), 10)
  return rows
    .filter((r) => r.active && r.is_visible !== false)
    .filter((r) => !cats || cats.includes(String(r.category ?? '').toLowerCase()))
    .filter((r) => !loc || locationMatches(r.locations ?? [], loc))
    .filter((r) => !kw || `${r.title} ${r.company_name}`.toLowerCase().includes(kw))
    .sort((a, b) => (b.date_posted ?? 0) - (a.date_posted ?? 0))
    .slice(0, n)
    .map((r) => ({
      company: r.company_name,
      title: r.title,
      locations: (r.locations ?? []).slice(0, 3).join('; ') || 'Not listed',
      url: r.url,
      postedDaysAgo: r.date_posted ? Math.max(0, Math.floor((now / 1000 - r.date_posted) / 86400)) : null,
    }))
}

export function jobsServer({ fetchImpl = fetch } = {}) {
  return createSdkMcpServer({
    name: 'jobs',
    version: '1.0.0',
    instructions: 'Find current internships and new-grad roles from the SimplifyJobs lists.',
    alwaysLoad: true,
    tools: [
      tool(
        'find_jobs',
        'Search the SimplifyJobs lists (updated daily) for open roles, newest first. Use for any "find me internships/jobs" request.',
        {
          kind: z.enum(['internship', 'newgrad']).optional().describe('internship (default) or newgrad'),
          role: z.enum(['software', 'data', 'quant', 'product', 'hardware', 'any']).optional()
            .describe('Role family: software (default), data (AI/ML/data science), quant, product, hardware, or any'),
          location: z.string().optional().describe('City, state, country or "remote"; matched loosely. Empty = anywhere'),
          keyword: z.string().optional().describe('Optional word to match in the title or company, e.g. "frontend" or "Google"'),
          count: z.number().optional().describe('How many to return, 1-10 (default 5)'),
        },
        async ({ kind = 'internship', role = 'software', location = '', keyword = '', count = 5 }) => {
          try {
            const rows = await load(kind, fetchImpl)
            const hits = searchJobs(rows, { role: role === 'any' ? '' : role, location, keyword, count })
            const text = hits.length
              ? hits.map((h, i) => `${i + 1}. ${h.company} — ${h.title} — ${h.locations} — ${h.url}` +
                  (h.postedDaysAgo === null ? '' : ` — posted ${h.postedDaysAgo === 0 ? 'today' : `${h.postedDaysAgo}d ago`}`)).join('\n')
              : 'No open roles matched. Try a broader location or role.'
            return { content: [{ type: 'text', text }] }
          } catch (err) {
            return { content: [{ type: 'text', text: `Could not load the job list: ${err.message}` }], isError: true }
          }
        },
      ),
    ],
  })
}
