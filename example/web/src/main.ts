import { bridge, BridgeError } from '../../../dist/web/index.js'

const status = document.getElementById('status')!
const log = document.getElementById('log')!

function write(line: string) {
  log.textContent = `${new Date().toISOString().slice(11, 19)} ${line}\n${log.textContent}`
}

async function run(label: string, fn: () => Promise<unknown>) {
  try {
    write(`${label} → ok ${JSON.stringify(await fn())}`)
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : 'UNEXPECTED'
    write(`${label} → error ${code}: ${(error as Error).message}`)
  }
}

const probe = window as unknown as { __MOBILE_APP_BRIDGE__?: unknown; ReactNativeWebView?: unknown }
status.textContent = `badge=${!!probe.__MOBILE_APP_BRIDGE__} rnwv=${!!probe.ReactNativeWebView} | 1. isApp=${bridge.isApp} info=${JSON.stringify(bridge.info)} gtag=${typeof (window as unknown as { dataLayer?: unknown }).dataLayer !== 'undefined' || !!document.querySelector('script[src*="gtag"]')}`

// Diagnostics: lets the e2e run count badge races across reloads.
void fetch(`/report?badge=${!!probe.__MOBILE_APP_BRIDGE__}&rnwv=${!!probe.ReactNativeWebView}&isApp=${bridge.isApp}`).catch(() => {})

// 8. Pull, don't push: data captured before the page existed is fetched once the page is ready.
if (bridge.isApp) void run('8. app.getLaunchInfo (pulled on boot)', () => bridge.call('app.getLaunchInfo'))
bridge.on('app.stateChange', (data) => write(`9. app.stateChange ${JSON.stringify(data)}`))

async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    return `ok:${JSON.stringify(await fn())}`
  } catch (error) {
    return `error:${error instanceof BridgeError ? error.code : 'UNEXPECTED'}`
  }
}

// One tap runs every RPC scenario that needs no native UI, checks it, and reports to the dev server.
async function runAutomatedChecks() {
  const checks: Array<[string, () => Promise<unknown>, (result: string) => boolean]> = [
    ['2', () => bridge.call('test.echo', { hello: 'world', n: 42 }), (r) => r === 'ok:{"hello":"world","n":42}'],
    ['4', () => bridge.call('haptics.impact', { style: 'medium' }), (r) => r === 'ok:{"style":"medium"}'],
    ['6a', () => bridge.call('nope.nothing'), (r) => r === 'error:UNKNOWN_METHOD'],
    ['6b', () => bridge.call('test.throw'), (r) => r === 'error:CUSTOM'],
    ['7', () => bridge.call('test.sleep', { ms: 3000 }, { timeout: 500 }), (r) => r === 'error:TIMEOUT'],
    ['8', () => bridge.call('app.getLaunchInfo'), (r) => r.startsWith('ok:{"launchedAt":')],
  ]
  const lines: string[] = []
  for (const [id, fn, pass] of checks) {
    const result = await outcome(fn)
    lines.push(`${id}=${pass(result) ? 'PASS' : `FAIL(${result})`}`)
  }
  const summary = `auto platform=${bridge.info?.platform ?? 'unknown'} ${lines.join(' ')}`
  write(summary)
  void fetch(`/report?${encodeURIComponent(summary)}`).catch(() => {})
}

const actions: Record<string, () => void> = {
  auto: () => void runAutomatedChecks(),
  echo: () => run('2. test.echo', () => bridge.call('test.echo', { hello: 'world', n: 42 })),
  camera: () => run('3. camera', () => bridge.call('camera.requestPermission', undefined, { timeout: 0 })),
  haptics: () => run('4. haptics', () => bridge.call('haptics.impact', { style: 'medium' })),
  unsupported: () => run('5. unsupported', () => bridge.call('app.unsupported', { feature: 'Export report' })),
  unknown: () => run('6a. unknown', () => bridge.call('nope.nothing')),
  throw: () => run('6b. throw', () => bridge.call('test.throw')),
  timeout: () => run('7. timeout', () => bridge.call('test.sleep', { ms: 3000 }, { timeout: 500 })),
  pushState: () => {
    // What Inertia/SPA routers do on every visit; native events must keep flowing afterwards.
    history.pushState({}, '', `/?visit=${Date.now()}`)
    write(`17. pushState → ${location.pathname}${location.search}`)
  },
  legacy: () => {
    const native = (window as unknown as { ReactNativeWebView?: { postMessage(m: string): void } }).ReactNativeWebView
    native?.postMessage(JSON.stringify({ event_name: 'legacyLogin' }))
    write(`11. legacy sent (inApp=${!!native})`)
  },
}

document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
  button.addEventListener('click', () => actions[button.dataset.action!]?.())
})
