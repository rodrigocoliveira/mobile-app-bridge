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
void fetch(`/report?badge=${!!probe.__MOBILE_APP_BRIDGE__}&rnwv=${!!probe.ReactNativeWebView}&ua=${navigator.userAgent.includes("MobileAppBridge/1")}&isApp=${bridge.isApp}`).catch(() => {})

bridge.on('test.early', (data) => write(`8. test.early received ${JSON.stringify(data)}`))
bridge.on('app.stateChange', (data) => write(`9. app.stateChange ${JSON.stringify(data)}`))

const actions: Record<string, () => void> = {
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
