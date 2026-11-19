// Manual check, not part of `npm test` (needs playwright + a running JARVIS):
//   npm i playwright && node scripts/ptt-browser-check.mjs <url> <user> <pass> <speech.wav>
// The wav is played on loop as a fake microphone.
// Real-browser push-to-talk test: fake mic loops a spoken question; checks
// nothing is sent while Space is up, and exactly one turn is sent per hold.
import { chromium } from 'playwright'
const [,, url, user, pass, wav] = process.argv
const t0 = Date.now(); const ts = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ httpCredentials: { username: user, password: pass }, permissions: ['microphone'] })
const page = await ctx.newPage()
const asks = [], dones = [], stt = []
page.on('websocket', (ws) => {
  ws.on('framesent', (f) => { try { const m = JSON.parse(f.payload); if (m.type === 'ask') { asks.push(m.text); console.log(ts(), 'ASK SENT:', m.text) } } catch {} })
  ws.on('framereceived', (f) => { try { const m = JSON.parse(f.payload); if (m.type === 'done') { dones.push(m.text); console.log(ts(), 'REPLY:', (m.text || '').slice(0, 160)) } } catch {} })
})
page.on('request', (r) => { if (r.url().includes('/stt')) { stt.push(Date.now()); console.log(ts(), 'stt request') } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(url)
await page.click('button.ignition')
console.log(ts(), 'initialised; waiting for boot')
await page.waitForFunction(() => /HOLD SPACE TO TALK/.test(document.body.innerText), null, { timeout: 90000 })
const status = async () => (await page.locator('.hud-top').innerText()).replace(/\s+/g, ' ').slice(0, 120)
console.log(ts(), 'booted:', await status())

console.log(ts(), '--- PHASE A: 20s with Space UP (mic is playing the question on loop) ---')
await page.waitForTimeout(20000)
const aAsks = asks.length, aStt = stt.length
console.log(ts(), `phase A result: asks=${aAsks} stt=${aStt}  (expect 0/0)`)

for (const n of [1, 2]) {
  console.log(ts(), `--- PHASE B${n}: hold Space 5.5s, release ---`)
  const before = asks.length, beforeDone = dones.length
  await page.keyboard.down('Space')
  await page.waitForTimeout(800)
  console.log(ts(), 'while held:', await status())
  await page.waitForTimeout(4700)
  await page.keyboard.up('Space')
  console.log(ts(), 'released:', await status())
  const deadline = Date.now() + 90000
  while (Date.now() < deadline && dones.length === beforeDone) await page.waitForTimeout(500)
  console.log(ts(), `phase B${n} result: asks sent=${asks.length - before} (expect 1), reply=${dones.length > beforeDone}`)
  await page.waitForTimeout(12000) // let him finish speaking
  const quietBefore = asks.length
  await page.waitForTimeout(10000)
  console.log(ts(), `after reply, Space up 10s: extra asks=${asks.length - quietBefore} (expect 0)`)
}
console.log('SUMMARY', JSON.stringify({ phaseA: { asks: aAsks, stt: aStt }, asks, replies: dones.map((d) => d.slice(0, 100)) }))
await browser.close()
