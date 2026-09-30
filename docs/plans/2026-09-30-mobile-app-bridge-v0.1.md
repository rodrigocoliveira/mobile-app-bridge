# `@rodrigocoliveira/mobile-app-bridge` v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a tiny, promise-based bridge between a web page and the Expo WebView shell that loads it. The package exposes two entry points, `/web` and `/native`. An example app and web page verify it end to end on the iOS simulator.

**Architecture:**
- All logic lives in pure, framework-free TypeScript functions tested with `bun test`:
  - protocol guards
  - the web client
  - host matching
  - navigation policy
  - message routing
  - script builders
  - the emitter queue
- `BridgeWebView` is a thin React Native wrapper. It only wires those functions to `react-native-webview` props.
- An `example/` folder holds an Expo SDK 57 app (runs in Expo Go) and a static web page. Together they exercise every scenario on the iOS simulator.

**Tech Stack:**

| Area | Tools |
|---|---|
| Runtime and build | bun 1.3.9, TypeScript 5.9, tsup 8.5 |
| Release | changesets 3 |
| Mobile | react-native-webview 13.16.1, Expo SDK 57 (react 19.2.3, react-native 0.86.3) |

**Spec:** `docs/specs/2026-09-30-mobile-app-bridge-v0.1-design.md` (read it before starting; section numbers below refer to it)

**Repo root:** `/Users/rodrigocasagrande/Documents/Development/multek/open-source-packages/mobile-app-bridge` (already `git init`-ed on `main`, and contains `docs/`). All paths below are relative to it.

## Global Constraints

- Package name `@rodrigocoliveira/mobile-app-bridge`, MIT licence, `publishConfig.access: public`.
- Exactly two public entry points: `@rodrigocoliveira/mobile-app-bridge/web` and `@rodrigocoliveira/mobile-app-bridge/native`. There is no root `.` export.
- The `/web` build must not import `react`, `react-native`, `react-native-webview` or `expo-constants`.
- Importing `/web` must never touch `window` (SSR-safe).
- Wire constants must be spelled exactly as follows:
  - marker `"bridge": 1`
  - DOM event `mobile-app-bridge`
  - badge global `window.__MOBILE_APP_BRIDGE__`
  - buffer global `window.__MOBILE_APP_BRIDGE_BUFFER__`
- Default call timeout is `30_000` ms, and `0` disables it.
- Undelivered events are kept for `10_000` ms, with a maximum of `50`.
- Error codes are `NOT_IN_APP`, `TIMEOUT`, `UNKNOWN_METHOD`, `HANDLER_ERROR` and `INVALID_PARAMS`. The last one is added by this plan (see Task 2) and is used when `params` cannot be JSON-serialized.
- Host matching is exact on the hostname. `*.x.com` matches subdomains only.
- Two host lists: `trustedHosts` means the host loads in the app **and** may call handlers. `inAppHosts` (optional) means the host loads in the app **without** bridge access.
- All code and comments are in English.
- Commit after each task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do NOT create the GitHub repo, push, or publish to npm. Those steps are outward-facing and need the user's explicit approval (Task 9 ends with the handoff).

## Review Focus

These are the failure modes most likely to bite a real user that the spec does not spell out. Each one has a test in the task that owns the code.

1. **A method name that collides with `Object.prototype`** (`toString`, `constructor`, `__proto__`) must answer `UNKNOWN_METHOD`, not crash or call a prototype function. Tested in Task 4.
2. **URL tricks against host matching**, which must not be trusted:
   - userinfo: `https://app.brand.com@evil.io`
   - backslash: `https://evil.io\@app.brand.com`
   - suffix: `https://app.brand.com.evil.io`
   - Upper-case and trailing-dot hosts must still match.

   Tested in Task 3.
3. **A cold-start event emitted before the page subscribes** (for example, the app is opened from a push) must be delivered exactly once to the first subscriber within 10s, and never to one that subscribes later. Tested in Tasks 2 and 5.
4. **A handler that returns something JSON cannot serialize** (a circular object or a BigInt) must reject on the web with `HANDLER_ERROR`, not hang until timeout. The same applies to `params` that cannot be serialized, which reject with `INVALID_PARAMS`. Tested in Tasks 2 and 4.
5. **A consumer `injectedJavaScriptBeforeContentLoaded` that ends in a `// comment` or has no trailing semicolon** must still produce valid JS in which the badge runs. Tested in Task 4.

---

## File Structure

```
package.json                 # package manifest, exports map, scripts
tsconfig.json                # strict TS, DOM + JSX, noEmit
tsup.config.ts               # builds dist/web and dist/native (ESM + CJS + d.ts)
.gitignore
LICENSE
README.md
RELEASING.md
.changeset/config.json
.github/workflows/ci.yml
.github/workflows/release.yml
scripts/check-dist.ts        # asserts dist/web has no native imports and both entries exist
src/shared/protocol.ts       # wire types, constants, ErrorCode, isBridgeMessage()
src/web/errors.ts            # BridgeError
src/web/client.ts            # createBridgeClient(): isApp, info, call, on (+ buffering)
src/web/index.ts             # `bridge` singleton + public web exports
src/native/hosts.ts          # schemeOf, hostnameOf, isTrustedHostname, isTrustedUrl
src/native/navigation.ts     # decideNavigation, composeNavigationHandler
src/native/router.ts         # routeMessage, runHandler
src/native/scripts.ts        # serializeForScript, buildBadgeScript, buildDispatchScript, composeInjectedScript
src/native/app-info.ts       # resolveAppInfo
src/native/emitter.ts        # createEmitterCore (queue until page ready)
src/native/BridgeWebView.tsx # React Native wrapper component
src/native/useBridgeEmitter.ts
src/native/index.ts          # public native exports
test/*.test.ts               # bun tests, one file per src module
example/web/                 # static test page + Bun server (not published)
example/app/                 # Expo SDK 57 app for Expo Go (not published)
```

---

### Task 1: Tooling and wire protocol

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `LICENSE`
- Create: `src/shared/protocol.ts`
- Test: `test/protocol.test.ts`

**Interfaces:**
- Produces (from `src/shared/protocol.ts`):
  - `PROTOCOL_MARKER = 1`
  - `BRIDGE_EVENT = 'mobile-app-bridge'`
  - `BADGE_KEY = '__MOBILE_APP_BRIDGE__'`
  - `BUFFER_KEY = '__MOBILE_APP_BRIDGE_BUFFER__'`
  - `DEFAULT_TIMEOUT = 30_000`
  - `ErrorCode` (const object)
  - types `Platform`, `AppInfo`, `RequestMessage`, `ErrorPayload`, `ResponseMessage`, `EventMessage`, `BridgeMessage`
  - `isBridgeMessage(value: unknown): value is BridgeMessage`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@rodrigocoliveira/mobile-app-bridge",
  "version": "0.0.0",
  "description": "Promise-based bridge between a web app and the Expo WebView shell that loads it",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/rodrigocoliveira/mobile-app-bridge.git"
  },
  "homepage": "https://github.com/rodrigocoliveira/mobile-app-bridge#readme",
  "bugs": "https://github.com/rodrigocoliveira/mobile-app-bridge/issues",
  "keywords": ["expo", "react-native", "webview", "bridge", "postmessage"],
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./web": {
      "import": { "types": "./dist/web/index.d.ts", "default": "./dist/web/index.js" },
      "require": { "types": "./dist/web/index.d.cts", "default": "./dist/web/index.cjs" }
    },
    "./native": {
      "import": { "types": "./dist/native/index.d.ts", "default": "./dist/native/index.js" },
      "require": { "types": "./dist/native/index.d.cts", "default": "./dist/native/index.cjs" }
    },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc -p tsconfig.json",
    "test": "bun test",
    "check:dist": "bun run scripts/check-dist.ts",
    "changeset": "changeset",
    "version": "changeset version && bun install --lockfile-only",
    "release": "bun run build && bun run check:dist && changeset publish"
  },
  "peerDependencies": {
    "expo-constants": ">=17",
    "react": ">=18",
    "react-native": ">=0.76",
    "react-native-webview": ">=13.10"
  },
  "peerDependenciesMeta": {
    "expo-constants": { "optional": true },
    "react": { "optional": true },
    "react-native": { "optional": true },
    "react-native-webview": { "optional": true }
  },
  "publishConfig": { "access": "public" }
}
```

- [ ] **Step 2: Install dev dependencies**

Run:
```bash
bun add -d typescript@~5.9.3 @types/bun@^1.4.1 @changesets/cli@^3.0.3 react@19.2.3 @types/react@~19.2.0 react-native@0.86.3 react-native-webview@13.16.1 expo-constants@~57.0.20
```
Expected: `bun.lock` is created and `package.json` gains `devDependencies`. The react-native packages are dev-only, for typechecking `/native`.

- [ ] **Step 3: Create `tsconfig.json`, `.gitignore`, `LICENSE`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src", "test"]
}
```

`.gitignore`:
```
node_modules/
dist/
.DS_Store
example/web/dist/
example/app/.expo/
example/app/node_modules/
example/app/ios/
example/app/android/
```

`LICENSE`: the standard MIT licence text, `Copyright (c) 2026 Rodrigo Casagrande`.

- [ ] **Step 4: Write the failing test `test/protocol.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'
import { BADGE_KEY, BRIDGE_EVENT, BUFFER_KEY, ErrorCode, isBridgeMessage } from '../src/shared/protocol'

describe('constants', () => {
  test('wire names are stable', () => {
    expect(BRIDGE_EVENT).toBe('mobile-app-bridge')
    expect(BADGE_KEY).toBe('__MOBILE_APP_BRIDGE__')
    expect(BUFFER_KEY).toBe('__MOBILE_APP_BRIDGE_BUFFER__')
    expect(Object.values(ErrorCode).sort()).toEqual(
      ['HANDLER_ERROR', 'INVALID_PARAMS', 'NOT_IN_APP', 'TIMEOUT', 'UNKNOWN_METHOD'],
    )
  })
})

describe('isBridgeMessage', () => {
  test('accepts valid requests, responses and events', () => {
    expect(isBridgeMessage({ bridge: 1, kind: 'req', id: 'a', method: 'x.y' })).toBe(true)
    expect(isBridgeMessage({ bridge: 1, kind: 'res', id: 'a', ok: true, result: 1 })).toBe(true)
    expect(isBridgeMessage({ bridge: 1, kind: 'res', id: 'a', ok: false, error: { code: 'X', message: 'm' } })).toBe(true)
    expect(isBridgeMessage({ bridge: 1, kind: 'evt', name: 'app.stateChange', data: {} })).toBe(true)
  })

  test('rejects anything else', () => {
    expect(isBridgeMessage(null)).toBe(false)
    expect(isBridgeMessage('string')).toBe(false)
    expect(isBridgeMessage({ event_name: 'agendartLogin' })).toBe(false)
    expect(isBridgeMessage({ bridge: 2, kind: 'req', id: 'a', method: 'x' })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'req', id: 1, method: 'x' })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'req', id: 'a' })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'res', id: 'a', ok: false })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'evt' })).toBe(false)
    expect(isBridgeMessage({ bridge: 1, kind: 'other', id: 'a' })).toBe(false)
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `bun test test/protocol.test.ts`
Expected: FAIL with `Cannot find module '../src/shared/protocol'`.

- [ ] **Step 6: Implement `src/shared/protocol.ts`**

```ts
export const PROTOCOL_MARKER = 1 as const
export const BRIDGE_EVENT = 'mobile-app-bridge'
export const BADGE_KEY = '__MOBILE_APP_BRIDGE__'
export const BUFFER_KEY = '__MOBILE_APP_BRIDGE_BUFFER__'
export const DEFAULT_TIMEOUT = 30_000

export const ErrorCode = {
  NOT_IN_APP: 'NOT_IN_APP',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN_METHOD: 'UNKNOWN_METHOD',
  HANDLER_ERROR: 'HANDLER_ERROR',
  INVALID_PARAMS: 'INVALID_PARAMS',
} as const

export type Platform = 'ios' | 'android'

export interface AppInfo {
  platform: Platform
  appVersion: string
  buildNumber: string
}

export interface RequestMessage {
  bridge: typeof PROTOCOL_MARKER
  kind: 'req'
  id: string
  method: string
  params?: unknown
}

export interface ErrorPayload {
  code: string
  message: string
}

export type ResponseMessage =
  | { bridge: typeof PROTOCOL_MARKER; kind: 'res'; id: string; ok: true; result?: unknown }
  | { bridge: typeof PROTOCOL_MARKER; kind: 'res'; id: string; ok: false; error: ErrorPayload }

export interface EventMessage {
  bridge: typeof PROTOCOL_MARKER
  kind: 'evt'
  name: string
  data?: unknown
}

export type BridgeMessage = RequestMessage | ResponseMessage | EventMessage

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  if (message.bridge !== PROTOCOL_MARKER) return false

  switch (message.kind) {
    case 'req':
      return typeof message.id === 'string' && typeof message.method === 'string'
    case 'res':
      if (typeof message.id !== 'string' || typeof message.ok !== 'boolean') return false
      return message.ok || (typeof message.error === 'object' && message.error !== null)
    case 'evt':
      return typeof message.name === 'string'
    default:
      return false
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: all tests PASS and `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock tsconfig.json .gitignore LICENSE src/shared/protocol.ts test/protocol.test.ts
git commit -m "feat: add wire protocol types and guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Web client (`/web`)

**Files:**
- Create: `src/web/errors.ts`, `src/web/client.ts`, `src/web/index.ts`
- Test: `test/web-client.test.ts`
- Modify: `docs/specs/2026-09-30-mobile-app-bridge-v0.1-design.md` (§4 error table: add the `INVALID_PARAMS` row)

**Interfaces:**
- Consumes: everything from `src/shared/protocol.ts` (Task 1).
- Produces:
  - `class BridgeError extends Error { readonly code: string; constructor(code: string, message: string) }`
  - `interface BridgeWindow { __MOBILE_APP_BRIDGE__?: AppInfo; __MOBILE_APP_BRIDGE_BUFFER__?: unknown[]; ReactNativeWebView?: { postMessage(message: string): void }; addEventListener(type: string, listener: (event: Event) => void): void }`
  - `interface CallOptions { timeout?: number }`
  - `interface BridgeClient { readonly isApp: boolean; readonly info: AppInfo | null; call<T = unknown>(method: string, params?: unknown, options?: CallOptions): Promise<T>; on<T = unknown>(name: string, listener: (data: T) => void): () => void }`
  - `createBridgeClient(getWindow: () => BridgeWindow | undefined, options?: { now?: () => number }): BridgeClient`
  - `UNDELIVERED_TTL_MS = 10_000`, `MAX_UNDELIVERED = 50`
  - `src/web/index.ts` exports `bridge`, `createBridgeClient`, `BridgeError`, `ErrorCode`, and the types `BridgeClient`, `BridgeWindow`, `CallOptions`, `AppInfo`.

- [ ] **Step 1: Write the failing test `test/web-client.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'
import { BRIDGE_EVENT, type AppInfo, type RequestMessage } from '../src/shared/protocol'
import { BridgeError } from '../src/web/errors'
import { createBridgeClient, MAX_UNDELIVERED, type BridgeWindow } from '../src/web/client'

const INFO: AppInfo = { platform: 'ios', appVersion: '1.2.3', buildNumber: '42' }

class FakeWindow extends EventTarget implements BridgeWindow {
  __MOBILE_APP_BRIDGE__?: AppInfo
  __MOBILE_APP_BRIDGE_BUFFER__?: unknown[]
  ReactNativeWebView?: { postMessage(message: string): void }
  posted: RequestMessage[] = []
}

function appWindow(): FakeWindow {
  const win = new FakeWindow()
  win.__MOBILE_APP_BRIDGE__ = INFO
  win.ReactNativeWebView = { postMessage: (message) => win.posted.push(JSON.parse(message)) }
  return win
}

function deliver(win: FakeWindow, detail: unknown) {
  win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail }))
}

describe('detection', () => {
  test('isApp is false without a window, without the badge, or without ReactNativeWebView', () => {
    expect(createBridgeClient(() => undefined).isApp).toBe(false)
    expect(createBridgeClient(() => new FakeWindow()).isApp).toBe(false)
    const badgeOnly = new FakeWindow()
    badgeOnly.__MOBILE_APP_BRIDGE__ = INFO
    expect(createBridgeClient(() => badgeOnly).isApp).toBe(false)
  })

  test('isApp and info reflect the badge inside the app', () => {
    const client = createBridgeClient(() => appWindow())
    expect(client.isApp).toBe(true)
    expect(client.info).toEqual(INFO)
    expect(createBridgeClient(() => new FakeWindow()).info).toBeNull()
  })

  test('importing the web entry without a window does not throw (SSR)', async () => {
    const mod = await import('../src/web/index')
    expect(mod.bridge.isApp).toBe(false)
  })
})

describe('call', () => {
  test('rejects with NOT_IN_APP outside the app and posts nothing', async () => {
    const win = new FakeWindow()
    const client = createBridgeClient(() => win)
    const error = await client.call('x').catch((e) => e)
    expect(error).toBeInstanceOf(BridgeError)
    expect(error.code).toBe('NOT_IN_APP')
    expect(win.posted).toHaveLength(0)
  })

  test('posts a request and resolves with the matching response', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const promise = client.call<{ echoed: number }>('test.echo', { n: 1 })
    const request = win.posted[0]!
    expect(request).toMatchObject({ bridge: 1, kind: 'req', method: 'test.echo', params: { n: 1 } })
    deliver(win, { bridge: 1, kind: 'res', id: 'other-id', ok: true, result: 'wrong' })
    deliver(win, { bridge: 1, kind: 'res', id: request.id, ok: true, result: { echoed: 1 } })
    expect(await promise).toEqual({ echoed: 1 })
  })

  test('omits params when undefined', () => {
    const win = appWindow()
    void createBridgeClient(() => win).call('x', undefined, { timeout: 0 }).catch(() => {})
    expect('params' in win.posted[0]!).toBe(false)
  })

  test('concurrent calls resolve independently', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const a = client.call('a')
    const b = client.call('b')
    const [reqA, reqB] = win.posted
    deliver(win, { bridge: 1, kind: 'res', id: reqB!.id, ok: true, result: 'B' })
    deliver(win, { bridge: 1, kind: 'res', id: reqA!.id, ok: true, result: 'A' })
    expect(await Promise.all([a, b])).toEqual(['A', 'B'])
  })

  test('rejects with the error code and message from the native side', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const promise = client.call('test.throw')
    deliver(win, { bridge: 1, kind: 'res', id: win.posted[0]!.id, ok: false, error: { code: 'CUSTOM', message: 'boom' } })
    const error = await promise.catch((e) => e)
    expect(error).toBeInstanceOf(BridgeError)
    expect(error.code).toBe('CUSTOM')
    expect(error.message).toBe('boom')
  })

  test('rejects with TIMEOUT and ignores a late response', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const error = await client.call('test.sleep', undefined, { timeout: 10 }).catch((e) => e)
    expect(error.code).toBe('TIMEOUT')
    expect(() => deliver(win, { bridge: 1, kind: 'res', id: win.posted[0]!.id, ok: true })).not.toThrow()
  })

  test('rejects with INVALID_PARAMS when params cannot be serialized, and posts nothing', async () => {
    const win = appWindow()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const error = await createBridgeClient(() => win).call('x', circular).catch((e) => e)
    expect(error.code).toBe('INVALID_PARAMS')
    expect(win.posted).toHaveLength(0)
  })

  test('ignores non-bridge and malformed events', async () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const promise = client.call('x', undefined, { timeout: 20 })
    deliver(win, { event_name: 'legacy' })
    deliver(win, 'garbage')
    deliver(win, null)
    expect((await promise.catch((e) => e)).code).toBe('TIMEOUT')
  })
})

describe('on', () => {
  test('delivers events to subscribers and stops after unsubscribe', () => {
    const win = appWindow()
    const client = createBridgeClient(() => win)
    const received: unknown[] = []
    const off = client.on('app.stateChange', (data) => received.push(data))
    deliver(win, { bridge: 1, kind: 'evt', name: 'app.stateChange', data: { state: 'active' } })
    off()
    deliver(win, { bridge: 1, kind: 'evt', name: 'app.stateChange', data: { state: 'background' } })
    expect(received).toEqual([{ state: 'active' }])
  })

  test('drains the in-page buffer filled before the client attached, exactly once', () => {
    const win = appWindow()
    win.__MOBILE_APP_BRIDGE_BUFFER__ = [{ bridge: 1, kind: 'evt', name: 'push.opened', data: { url: '/a' } }]
    const client = createBridgeClient(() => win)
    const received: unknown[] = []
    client.on('push.opened', (data) => received.push(data))
    client.on('push.opened', (data) => received.push(data))
    expect(received).toEqual([{ url: '/a' }])
    expect(win.__MOBILE_APP_BRIDGE_BUFFER__).toBeUndefined()
  })

  test('replays an unsubscribed event to the first subscriber within 10s only', () => {
    let clock = 0
    const win = appWindow()
    const client = createBridgeClient(() => win, { now: () => clock })
    client.on('unrelated', () => {})
    deliver(win, { bridge: 1, kind: 'evt', name: 'fresh', data: 1 })
    deliver(win, { bridge: 1, kind: 'evt', name: 'stale', data: 2 })

    clock = 9_000
    const fresh: unknown[] = []
    client.on('fresh', (data) => fresh.push(data))
    expect(fresh).toEqual([1])

    clock = 10_001
    const stale: unknown[] = []
    client.on('stale', (data) => stale.push(data))
    expect(stale).toEqual([])
  })

  test(`keeps at most ${MAX_UNDELIVERED} undelivered events`, () => {
    const win = appWindow()
    const client = createBridgeClient(() => win, { now: () => 0 })
    client.on('unrelated', () => {})
    for (let i = 0; i < MAX_UNDELIVERED + 5; i++) deliver(win, { bridge: 1, kind: 'evt', name: 'burst', data: i })
    const received: unknown[] = []
    client.on('burst', (data) => received.push(data))
    expect(received).toHaveLength(MAX_UNDELIVERED)
    expect(received[0]).toBe(5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/web-client.test.ts`
Expected: FAIL with `Cannot find module '../src/web/errors'`.

- [ ] **Step 3: Implement `src/web/errors.ts`**

```ts
export class BridgeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
  }
}
```

- [ ] **Step 4: Implement `src/web/client.ts`**

```ts
import {
  BRIDGE_EVENT,
  DEFAULT_TIMEOUT,
  ErrorCode,
  isBridgeMessage,
  type AppInfo,
  type EventMessage,
  type RequestMessage,
} from '../shared/protocol'
import { BridgeError } from './errors'

export const UNDELIVERED_TTL_MS = 10_000
export const MAX_UNDELIVERED = 50

export interface BridgeWindow {
  __MOBILE_APP_BRIDGE__?: AppInfo
  __MOBILE_APP_BRIDGE_BUFFER__?: unknown[]
  ReactNativeWebView?: { postMessage(message: string): void }
  addEventListener(type: string, listener: (event: Event) => void): void
}

export interface CallOptions {
  /** Milliseconds to wait for the native response. Defaults to 30s; 0 disables the timeout. */
  timeout?: number
}

export interface BridgeClient {
  readonly isApp: boolean
  readonly info: AppInfo | null
  call<T = unknown>(method: string, params?: unknown, options?: CallOptions): Promise<T>
  on<T = unknown>(name: string, listener: (data: T) => void): () => void
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: BridgeError) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

type Listener = (data: unknown) => void

export function createBridgeClient(
  getWindow: () => BridgeWindow | undefined,
  options: { now?: () => number } = {},
): BridgeClient {
  const now = options.now ?? Date.now
  const pending = new Map<string, PendingCall>()
  const listeners = new Map<string, Set<Listener>>()
  let undelivered: Array<{ message: EventMessage; receivedAt: number }> = []
  let attachedTo: BridgeWindow | undefined
  let counter = 0

  function appWindow(): BridgeWindow | undefined {
    const win = getWindow()
    return win?.__MOBILE_APP_BRIDGE__ && win.ReactNativeWebView ? win : undefined
  }

  function pruneUndelivered() {
    const cutoff = now() - UNDELIVERED_TTL_MS
    undelivered = undelivered.filter((entry) => entry.receivedAt >= cutoff)
  }

  function deliverEvent(message: EventMessage) {
    const subscribers = listeners.get(message.name)
    if (subscribers && subscribers.size > 0) {
      for (const listener of [...subscribers]) listener(message.data)
      return
    }
    // Nobody is listening yet (e.g. cold start): keep it briefly for the first subscriber.
    pruneUndelivered()
    undelivered.push({ message, receivedAt: now() })
    if (undelivered.length > MAX_UNDELIVERED) undelivered.shift()
  }

  function handle(detail: unknown) {
    if (!isBridgeMessage(detail)) return
    if (detail.kind === 'evt') {
      deliverEvent(detail)
      return
    }
    if (detail.kind !== 'res') return

    const entry = pending.get(detail.id)
    if (!entry) return
    pending.delete(detail.id)
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    if (detail.ok) entry.resolve(detail.result)
    else entry.reject(new BridgeError(detail.error.code, detail.error.message))
  }

  function attach(win: BridgeWindow) {
    if (attachedTo === win) return
    attachedTo = win
    win.addEventListener(BRIDGE_EVENT, (event) => handle((event as CustomEvent).detail))

    // Events the badge script buffered before this client existed.
    const buffered = win.__MOBILE_APP_BRIDGE_BUFFER__
    win.__MOBILE_APP_BRIDGE_BUFFER__ = undefined
    if (Array.isArray(buffered)) for (const detail of buffered) handle(detail)
  }

  function nextId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${now().toString(36)}-${(counter++).toString(36)}`
  }

  return {
    get isApp() {
      return appWindow() !== undefined
    },

    get info() {
      return appWindow()?.__MOBILE_APP_BRIDGE__ ?? null
    },

    call<T = unknown>(method: string, params?: unknown, callOptions: CallOptions = {}): Promise<T> {
      const win = appWindow()
      if (!win?.ReactNativeWebView) {
        return Promise.reject(new BridgeError(ErrorCode.NOT_IN_APP, `Cannot call "${method}" outside the mobile app`))
      }
      attach(win)

      const id = nextId()
      const request: RequestMessage = { bridge: 1, kind: 'req', id, method }
      if (params !== undefined) request.params = params

      let payload: string
      try {
        payload = JSON.stringify(request)
      } catch {
        return Promise.reject(new BridgeError(ErrorCode.INVALID_PARAMS, `Params for "${method}" are not JSON-serializable`))
      }

      const timeout = callOptions.timeout ?? DEFAULT_TIMEOUT
      const postMessage = win.ReactNativeWebView.postMessage.bind(win.ReactNativeWebView)

      return new Promise<T>((resolve, reject) => {
        const timer =
          timeout > 0
            ? setTimeout(() => {
                if (pending.delete(id)) {
                  reject(new BridgeError(ErrorCode.TIMEOUT, `"${method}" did not respond within ${timeout}ms`))
                }
              }, timeout)
            : undefined
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        postMessage(payload)
      })
    },

    on<T = unknown>(name: string, listener: (data: T) => void): () => void {
      const win = appWindow()
      if (win) attach(win)

      let subscribers = listeners.get(name)
      if (!subscribers) {
        subscribers = new Set()
        listeners.set(name, subscribers)
      }
      const typed = listener as Listener
      subscribers.add(typed)

      pruneUndelivered()
      const replay = undelivered.filter((entry) => entry.message.name === name)
      if (replay.length > 0) {
        undelivered = undelivered.filter((entry) => entry.message.name !== name)
        for (const entry of replay) typed(entry.message.data)
      }

      return () => {
        subscribers.delete(typed)
      }
    },
  }
}
```

- [ ] **Step 5: Implement `src/web/index.ts`**

```ts
import { createBridgeClient, type BridgeWindow } from './client'

/** Shared client for the current page. Safe to import during SSR: it only reads `window` when used. */
export const bridge = createBridgeClient(() =>
  typeof window === 'undefined' ? undefined : (window as unknown as BridgeWindow),
)

export { createBridgeClient } from './client'
export type { BridgeClient, BridgeWindow, CallOptions } from './client'
export { BridgeError } from './errors'
export { ErrorCode } from '../shared/protocol'
export type { AppInfo } from '../shared/protocol'
```

- [ ] **Step 6: Run tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 7: Add `INVALID_PARAMS` to the spec's §4 error table**

In `docs/specs/2026-09-30-mobile-app-bridge-v0.1-design.md`, add a row after the `HANDLER_ERROR` row:
```
| `INVALID_PARAMS` | `params` cannot be JSON-serialized (rejects immediately, nothing sent) |
```

- [ ] **Step 8: Commit**

```bash
git add src/web test/web-client.test.ts docs/specs
git commit -m "feat(web): add promise-based bridge client with event buffering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Host matching and navigation policy (native core)

**Files:**
- Create: `src/native/hosts.ts`, `src/native/navigation.ts`
- Test: `test/hosts.test.ts`, `test/navigation.test.ts`

**Interfaces:**
- Produces:
  - `schemeOf(url: string): string | null` (lower-cased)
  - `hostnameOf(url: string): string | null` (lower-cased, trailing dot removed)
  - `isTrustedHostname(hostname: string, trustedHosts: readonly string[]): boolean`
  - `isTrustedUrl(url: string, trustedHosts: readonly string[]): boolean`
  - `type NavigationDecision = 'load' | 'block' | 'open-external'`
  - `interface NavigationRequestLike { url: string; isTopFrame?: boolean }`
  - `interface HostLists { trustedHosts: readonly string[]; inAppHosts: readonly string[] }`
  - `decideNavigation(request: NavigationRequestLike, hosts: HostLists): NavigationDecision`
  - `composeNavigationHandler<R extends NavigationRequestLike>(consumer: ((request: R) => boolean | undefined) | undefined, getHosts: () => HostLists, openExternal: (url: string) => void): (request: R) => boolean`

Note: the parser is regex-based on purpose, because React Native's `URL` polyfill has historically not implemented `hostname`.

- [ ] **Step 1: Write the failing test `test/hosts.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'
import { hostnameOf, isTrustedHostname, isTrustedUrl, schemeOf } from '../src/native/hosts'

describe('schemeOf / hostnameOf', () => {
  test('parses common URLs', () => {
    expect(schemeOf('HTTPS://App.Brand.com/x')).toBe('https')
    expect(hostnameOf('HTTPS://App.Brand.com/x')).toBe('app.brand.com')
    expect(hostnameOf('http://localhost:5055/')).toBe('localhost')
    expect(hostnameOf('https://app.brand.com.')).toBe('app.brand.com')
    expect(hostnameOf('https://user:pass@app.brand.com/')).toBe('app.brand.com')
    expect(schemeOf('tel:+5511999999999')).toBe('tel')
    expect(hostnameOf('tel:+5511999999999')).toBeNull()
    expect(schemeOf('about:blank')).toBe('about')
    expect(schemeOf('not a url')).toBeNull()
    expect(hostnameOf('')).toBeNull()
  })

  test('does not let userinfo or backslashes spoof the host', () => {
    expect(hostnameOf('https://app.brand.com@evil.io/')).toBe('evil.io')
    expect(hostnameOf('https://evil.io\\@app.brand.com/')).toBe('evil.io')
    expect(hostnameOf('https://evil.io\\app.brand.com')).toBe('evil.io')
  })
})

describe('isTrustedHostname', () => {
  const trusted = ['app.brand.com', '*.cdn.brand.com', 'localhost']

  test('exact match, case-insensitive', () => {
    expect(isTrustedHostname('app.brand.com', trusted)).toBe(true)
    expect(isTrustedHostname('APP.BRAND.COM', trusted)).toBe(true)
    expect(isTrustedHostname('localhost', trusted)).toBe(true)
  })

  test('wildcard matches subdomains only', () => {
    expect(isTrustedHostname('img.cdn.brand.com', trusted)).toBe(true)
    expect(isTrustedHostname('a.b.cdn.brand.com', trusted)).toBe(true)
    expect(isTrustedHostname('cdn.brand.com', trusted)).toBe(false)
  })

  test('rejects look-alikes', () => {
    expect(isTrustedHostname('evilapp.brand.com', trusted)).toBe(false)
    expect(isTrustedHostname('app.brand.com.evil.io', trusted)).toBe(false)
    expect(isTrustedHostname('brand.com', trusted)).toBe(false)
    expect(isTrustedHostname('evilcdn.brand.com', trusted)).toBe(false)
  })
})

describe('isTrustedUrl', () => {
  test('uses the real host', () => {
    expect(isTrustedUrl('https://app.brand.com/dashboard', ['app.brand.com'])).toBe(true)
    expect(isTrustedUrl('https://app.brand.com@evil.io/', ['app.brand.com'])).toBe(false)
    expect(isTrustedUrl('https://evil.io\\@app.brand.com/', ['app.brand.com'])).toBe(false)
    expect(isTrustedUrl('https://app.brand.com.evil.io/', ['app.brand.com'])).toBe(false)
    expect(isTrustedUrl('garbage', ['app.brand.com'])).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/hosts.test.ts`
Expected: FAIL with `Cannot find module '../src/native/hosts'`.

- [ ] **Step 3: Implement `src/native/hosts.ts`**

```ts
// Regex-based on purpose: React Native's URL polyfill has historically not implemented `hostname`.
// Backslashes are excluded from userinfo/host because browsers treat `\` as `/` in http(s) URLs.
const URL_PATTERN = /^([a-z][a-z0-9+.-]*):(?:\/\/(?:[^@/\\?#]*@)?(\[[^\]]*\]|[^:/\\?#]*))?/i

export function schemeOf(url: string): string | null {
  const match = URL_PATTERN.exec(url.trim())
  return match ? match[1]!.toLowerCase() : null
}

export function hostnameOf(url: string): string | null {
  const host = URL_PATTERN.exec(url.trim())?.[2]
  if (!host) return null
  return host.toLowerCase().replace(/\.$/, '')
}

export function isTrustedHostname(hostname: string, trustedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return trustedHosts.some((entry) => {
    const pattern = entry.toLowerCase()
    if (pattern.startsWith('*.')) return host.endsWith(`.${pattern.slice(2)}`)
    return host === pattern
  })
}

export function isTrustedUrl(url: string, trustedHosts: readonly string[]): boolean {
  const hostname = hostnameOf(url)
  return hostname !== null && isTrustedHostname(hostname, trustedHosts)
}
```

- [ ] **Step 4: Run `bun test test/hosts.test.ts`**. Expected: PASS.

- [ ] **Step 5: Write the failing test `test/navigation.test.ts`**

```ts
import { describe, expect, mock, test } from 'bun:test'
import { composeNavigationHandler, decideNavigation, type HostLists } from '../src/native/navigation'

const hosts: HostLists = { trustedHosts: ['app.brand.com'], inAppHosts: ['*.amazonaws.com'] }

describe('decideNavigation', () => {
  test('loads trusted http(s) in the WebView', () => {
    expect(decideNavigation({ url: 'https://app.brand.com/x', isTopFrame: true }, hosts)).toBe('load')
    expect(decideNavigation({ url: 'https://app.brand.com/x' }, hosts)).toBe('load')
  })

  test('loads inAppHosts in the WebView too', () => {
    expect(decideNavigation({ url: 'https://files.s3.amazonaws.com/a.pdf', isTopFrame: true }, hosts)).toBe('load')
    expect(decideNavigation({ url: 'https://amazonaws.com.evil.io/', isTopFrame: true }, hosts)).toBe('open-external')
  })

  test('loads any http(s) subframe so third-party iframes keep working', () => {
    expect(decideNavigation({ url: 'https://www.google.com/recaptcha/api2/anchor', isTopFrame: false }, hosts)).toBe('load')
    expect(decideNavigation({ url: 'https://www.googletagmanager.com/ns.html?id=GTM-X', isTopFrame: false }, hosts)).toBe('load')
    expect(decideNavigation({ url: 'about:blank', isTopFrame: false }, hosts)).toBe('load')
  })

  test('blocks dangerous schemes in the top frame', () => {
    for (const url of ['about:blank', 'blob:https://app.brand.com/1', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi']) {
      expect(decideNavigation({ url, isTopFrame: true }, hosts)).toBe('block')
    }
    expect(decideNavigation({ url: 'not a url' }, hosts)).toBe('block')
  })

  test('opens everything else externally', () => {
    for (const url of ['https://example.com', 'https://app.brand.com@evil.io/', 'tel:+551199', 'mailto:a@b.com', 'whatsapp://send?text=hi']) {
      expect(decideNavigation({ url, isTopFrame: true }, hosts)).toBe('open-external')
    }
  })
})

describe('composeNavigationHandler', () => {
  test('consumer true/false wins and skips the default policy', () => {
    const openExternal = mock(() => {})
    const allow = composeNavigationHandler(() => true, () => hosts, openExternal)
    const deny = composeNavigationHandler(() => false, () => hosts, openExternal)
    expect(allow({ url: 'https://example.com' })).toBe(true)
    expect(deny({ url: 'https://app.brand.com' })).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  test('consumer undefined falls back to the default policy', () => {
    const openExternal = mock((_url: string) => {})
    const handler = composeNavigationHandler(() => undefined, () => hosts, openExternal)
    expect(handler({ url: 'https://app.brand.com/x' })).toBe(true)
    expect(handler({ url: 'https://example.com' })).toBe(false)
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(handler({ url: 'about:blank', isTopFrame: true })).toBe(false)
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  test('works without a consumer and reads host lists lazily', () => {
    let current: HostLists = { trustedHosts: [], inAppHosts: [] }
    const handler = composeNavigationHandler(undefined, () => current, () => {})
    expect(handler({ url: 'https://app.brand.com' })).toBe(false)
    current = hosts
    expect(handler({ url: 'https://app.brand.com' })).toBe(true)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test test/navigation.test.ts`
Expected: FAIL with `Cannot find module '../src/native/navigation'`.

- [ ] **Step 7: Implement `src/native/navigation.ts`**

```ts
import { isTrustedUrl, schemeOf } from './hosts'

export type NavigationDecision = 'load' | 'block' | 'open-external'

export interface NavigationRequestLike {
  url: string
  /** iOS only. Android only asks about top-frame navigations, so `undefined` means top frame. */
  isTopFrame?: boolean
}

export interface HostLists {
  /** Load in the WebView and may call handlers. */
  trustedHosts: readonly string[]
  /** Load in the WebView without bridge access (file previews, OAuth, 3-D Secure). */
  inAppHosts: readonly string[]
}

const BLOCKED_SCHEMES = new Set(['about', 'blob', 'file', 'javascript', 'data'])

export function decideNavigation(request: NavigationRequestLike, hosts: HostLists): NavigationDecision {
  const scheme = schemeOf(request.url)
  const isHttp = scheme === 'http' || scheme === 'https'
  const isSubframe = request.isTopFrame === false

  if (isHttp && (isTrustedUrl(request.url, hosts.trustedHosts) || isTrustedUrl(request.url, hosts.inAppHosts))) {
    return 'load'
  }
  // Iframes (reCAPTCHA, maps, GTM, payment widgets) must load in place; they never get the badge.
  if (isSubframe && (isHttp || scheme === 'about')) return 'load'
  if (scheme === null || BLOCKED_SCHEMES.has(scheme)) return 'block'
  return 'open-external'
}

export function composeNavigationHandler<R extends NavigationRequestLike>(
  consumer: ((request: R) => boolean | undefined) | undefined,
  getHosts: () => HostLists,
  openExternal: (url: string) => void,
): (request: R) => boolean {
  return (request) => {
    const custom = consumer?.(request)
    if (typeof custom === 'boolean') return custom

    const decision = decideNavigation(request, getHosts())
    if (decision === 'open-external') openExternal(request.url)
    return decision === 'load'
  }
}
```

- [ ] **Step 8: Run `bun test && bun run typecheck`**. Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/native/hosts.ts src/native/navigation.ts test/hosts.test.ts test/navigation.test.ts
git commit -m "feat(native): add strict host matching and navigation policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Message routing, injected scripts and app info (native core)

**Files:**
- Create: `src/native/router.ts`, `src/native/scripts.ts`, `src/native/app-info.ts`
- Test: `test/router.test.ts`, `test/scripts.test.ts`, `test/app-info.test.ts`

**Interfaces:**
- Consumes:
  - `isTrustedUrl` (Task 3)
  - protocol types and constants (Task 1)
- Produces:
  - `type Handler = (params: any) => unknown`
  - `type Handlers = Record<string, Handler>`
  - `type RouteResult = { type: 'forward' } | { type: 'drop'; reason: 'untrusted-origin' | 'unexpected-kind' } | { type: 'response'; response: Promise<ResponseMessage> }`
  - `routeMessage(raw: string, sourceUrl: string, handlers: Handlers, trustedHosts: readonly string[]): RouteResult`
  - `runHandler(request: RequestMessage, handlers: Handlers): Promise<ResponseMessage>`
  - `serializeForScript(value: unknown): string`
  - `buildBadgeScript(info: AppInfo): string`
  - `buildDispatchScript(message: ResponseMessage | EventMessage): string`
  - `composeInjectedScript(info: AppInfo, consumerScript?: string): string`
  - `BUFFER_LIMIT = 50` (in `scripts.ts`)
  - `interface ExpoConfigLike { version?: string; ios?: { buildNumber?: string }; android?: { versionCode?: number } }`
  - `resolveAppInfo(platformOS: string, expoConfig: ExpoConfigLike | null | undefined, override?: Partial<AppInfo>): AppInfo`

- [ ] **Step 1: Write the failing test `test/router.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'
import { routeMessage, type Handlers } from '../src/native/router'

const trusted = ['localhost']
const origin = 'http://localhost:5055/'
const req = (method: string, params?: unknown) => JSON.stringify({ bridge: 1, kind: 'req', id: 'r1', method, params })

async function respond(raw: string, handlers: Handlers, url = origin) {
  const route = routeMessage(raw, url, handlers, trusted)
  if (route.type !== 'response') throw new Error(`expected response, got ${route.type}`)
  return route.response
}

describe('routeMessage', () => {
  test('calls the handler with params and answers ok', async () => {
    const response = await respond(req('test.echo', { n: 1 }), { 'test.echo': (p) => p })
    expect(response).toEqual({ bridge: 1, kind: 'res', id: 'r1', ok: true, result: { n: 1 } })
  })

  test('awaits async handlers', async () => {
    const response = await respond(req('slow'), { slow: async () => 'done' })
    expect(response).toMatchObject({ ok: true, result: 'done' })
  })

  test('answers UNKNOWN_METHOD for missing handlers, including Object.prototype names', async () => {
    for (const method of ['nope.nothing', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      const response = await respond(req(method), {})
      expect(response).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } })
    }
  })

  test('uses the thrown code, or HANDLER_ERROR', async () => {
    const custom = await respond(req('t'), { t: () => { throw Object.assign(new Error('boom'), { code: 'CUSTOM' }) } })
    expect(custom).toMatchObject({ ok: false, error: { code: 'CUSTOM', message: 'boom' } })
    const plain = await respond(req('t'), { t: async () => { throw new Error('plain') } })
    expect(plain).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR', message: 'plain' } })
    const weird = await respond(req('t'), { t: () => { throw 'a string' } })
    expect(weird).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR', message: 'a string' } })
  })

  test('answers HANDLER_ERROR when the result is not JSON-serializable', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const response = await respond(req('t'), { t: () => circular })
    expect(response).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR' } })
    const bigint = await respond(req('t'), { t: () => 10n })
    expect(bigint).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR' } })
  })

  test('drops requests from untrusted origins without calling the handler', () => {
    let called = false
    const route = routeMessage(req('t'), 'http://127.0.0.1:5055/iframe.html', { t: () => { called = true } }, trusted)
    expect(route).toEqual({ type: 'drop', reason: 'untrusted-origin' })
    expect(called).toBe(false)
  })

  test('drops requests from inAppHosts pages: they load in the app but are not trusted', () => {
    // routeMessage only ever receives trustedHosts; inAppHosts must never be passed to it.
    const route = routeMessage(req('t'), 'http://127.0.0.1:5055/second.html', { t: () => 'x' }, trusted)
    expect(route).toEqual({ type: 'drop', reason: 'untrusted-origin' })
  })

  test('drops bridge messages that are not requests', () => {
    const raw = JSON.stringify({ bridge: 1, kind: 'evt', name: 'x' })
    expect(routeMessage(raw, origin, {}, trusted)).toEqual({ type: 'drop', reason: 'unexpected-kind' })
  })

  test('forwards non-bridge messages and invalid JSON to the consumer', () => {
    expect(routeMessage(JSON.stringify({ event_name: 'agendartLogin' }), origin, {}, trusted)).toEqual({ type: 'forward' })
    expect(routeMessage('not json', origin, {}, trusted)).toEqual({ type: 'forward' })
    expect(routeMessage('"a string"', origin, {}, trusted)).toEqual({ type: 'forward' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/router.test.ts`
Expected: FAIL with `Cannot find module '../src/native/router'`.

- [ ] **Step 3: Implement `src/native/router.ts`**

```ts
import {
  ErrorCode,
  isBridgeMessage,
  type ErrorPayload,
  type RequestMessage,
  type ResponseMessage,
} from '../shared/protocol'
import { isTrustedUrl } from './hosts'

// biome-ignore lint: handlers receive whatever the page sent.
export type Handler = (params: any) => unknown
export type Handlers = Record<string, Handler>

export type RouteResult =
  | { type: 'forward' }
  | { type: 'drop'; reason: 'untrusted-origin' | 'unexpected-kind' }
  | { type: 'response'; response: Promise<ResponseMessage> }

export function routeMessage(
  raw: string,
  sourceUrl: string,
  handlers: Handlers,
  trustedHosts: readonly string[],
): RouteResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { type: 'forward' }
  }

  if (!isBridgeMessage(parsed)) return { type: 'forward' }
  if (parsed.kind !== 'req') return { type: 'drop', reason: 'unexpected-kind' }
  if (!isTrustedUrl(sourceUrl, trustedHosts)) return { type: 'drop', reason: 'untrusted-origin' }

  return { type: 'response', response: runHandler(parsed, handlers) }
}

export async function runHandler(request: RequestMessage, handlers: Handlers): Promise<ResponseMessage> {
  // Own-property check so names like "toString" never reach Object.prototype.
  const handler = Object.prototype.hasOwnProperty.call(handlers, request.method) ? handlers[request.method] : undefined
  if (!handler) {
    return failure(request.id, { code: ErrorCode.UNKNOWN_METHOD, message: `No handler registered for "${request.method}"` })
  }

  let result: unknown
  try {
    result = await handler(request.params)
  } catch (error) {
    return failure(request.id, toErrorPayload(error))
  }

  try {
    JSON.stringify(result)
  } catch {
    return failure(request.id, {
      code: ErrorCode.HANDLER_ERROR,
      message: `Result of "${request.method}" is not JSON-serializable`,
    })
  }

  return { bridge: 1, kind: 'res', id: request.id, ok: true, result }
}

function failure(id: string, error: ErrorPayload): ResponseMessage {
  return { bridge: 1, kind: 'res', id, ok: false, error }
}

function toErrorPayload(error: unknown): ErrorPayload {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown }
    return {
      code: typeof code === 'string' ? code : ErrorCode.HANDLER_ERROR,
      message: typeof message === 'string' ? message : String(error),
    }
  }
  return { code: ErrorCode.HANDLER_ERROR, message: String(error) }
}
```

Remove the `biome-ignore` comment line if the repo has no linter; keep the `any` in `Handler`, because it is intentional so that handlers can type their own params.

- [ ] **Step 4: Run `bun test test/router.test.ts`**. Expected: PASS.

- [ ] **Step 5: Write the failing test `test/scripts.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'
import { BRIDGE_EVENT, type AppInfo } from '../src/shared/protocol'
import { BUFFER_LIMIT, buildBadgeScript, buildDispatchScript, composeInjectedScript, serializeForScript } from '../src/native/scripts'

const INFO: AppInfo = { platform: 'ios', appVersion: '1.0.0', buildNumber: '7' }

class ScriptWindow extends EventTarget {
  [key: string]: unknown
}

function run(script: string, win = new ScriptWindow()) {
  // eslint-disable-next-line no-new-func
  new Function('window', 'CustomEvent', script)(win, CustomEvent)
  return win
}

describe('serializeForScript', () => {
  test('escapes sequences that could break out of a script', () => {
    const tricky = { a: '</script><script>alert(1)</script>', b: 'line sep ', c: "quote'\"" }
    const out = serializeForScript(tricky)
    expect(out).not.toContain('</script>')
    expect(out).not.toContain(' ')
    expect(out).not.toContain(' ')
    expect(new Function(`return ${out}`)()).toEqual(tricky)
  })
})

describe('buildBadgeScript', () => {
  test('sets the badge and buffers events until drained', () => {
    const win = run(buildBadgeScript(INFO))
    expect(win.__MOBILE_APP_BRIDGE__).toEqual(INFO)
    win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'evt', name: 'x', data: 1 } }))
    win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'res', id: 'a', ok: true } }))
    expect(win.__MOBILE_APP_BRIDGE_BUFFER__).toEqual([{ bridge: 1, kind: 'evt', name: 'x', data: 1 }])

    win.__MOBILE_APP_BRIDGE_BUFFER__ = undefined // what the web client does on attach
    expect(() => win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'evt', name: 'y' } }))).not.toThrow()
  })

  test(`caps the buffer at ${BUFFER_LIMIT}`, () => {
    const win = run(buildBadgeScript(INFO))
    for (let i = 0; i < BUFFER_LIMIT + 3; i++) {
      win.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { bridge: 1, kind: 'evt', name: 'x', data: i } }))
    }
    const buffer = win.__MOBILE_APP_BRIDGE_BUFFER__ as Array<{ data: number }>
    expect(buffer).toHaveLength(BUFFER_LIMIT)
    expect(buffer[0]!.data).toBe(3)
  })
})

describe('buildDispatchScript', () => {
  test('dispatches the message as a mobile-app-bridge CustomEvent', () => {
    const win = new ScriptWindow()
    const received: unknown[] = []
    win.addEventListener(BRIDGE_EVENT, (e) => received.push((e as CustomEvent).detail))
    const message = { bridge: 1, kind: 'evt', name: 'x', data: { text: '</script> ' } } as const
    run(buildDispatchScript(message), win)
    expect(received).toEqual([message])
  })
})

describe('composeInjectedScript', () => {
  test('runs the badge first, then the consumer script', () => {
    const win = run(composeInjectedScript(INFO, 'window.order = window.__MOBILE_APP_BRIDGE__ ? "after-badge" : "before-badge"'))
    expect(win.order).toBe('after-badge')
  })

  test('stays valid when the consumer script ends in a comment or lacks a semicolon', () => {
    expect(() => run(composeInjectedScript(INFO, 'window.a = 1 // trailing comment'))).not.toThrow()
    expect(() => run(composeInjectedScript(INFO, 'window.b = 2\n(function(){ window.c = 3 })()'))).not.toThrow()
    expect(() => run(composeInjectedScript(INFO))).not.toThrow()
    expect(run(composeInjectedScript(INFO)).__MOBILE_APP_BRIDGE__).toEqual(INFO)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test test/scripts.test.ts`
Expected: FAIL with `Cannot find module '../src/native/scripts'`.

- [ ] **Step 7: Implement `src/native/scripts.ts`**

```ts
import { BADGE_KEY, BRIDGE_EVENT, BUFFER_KEY, type AppInfo, type EventMessage, type ResponseMessage } from '../shared/protocol'

export const BUFFER_LIMIT = 50

/** JSON that is also safe to embed inside injected JavaScript. */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029')
}

export function buildBadgeScript(info: AppInfo): string {
  return [
    '(function () {',
    `  window.${BADGE_KEY} = ${serializeForScript(info)};`,
    `  window.${BUFFER_KEY} = [];`,
    `  window.addEventListener(${JSON.stringify(BRIDGE_EVENT)}, function (event) {`,
    `    var buffer = window.${BUFFER_KEY};`,
    '    var detail = event && event.detail;',
    "    if (!buffer || !detail || detail.kind !== 'evt') return;",
    '    buffer.push(detail);',
    `    if (buffer.length > ${BUFFER_LIMIT}) buffer.shift();`,
    '  });',
    '})();',
  ].join('\n')
}

export function buildDispatchScript(message: ResponseMessage | EventMessage): string {
  return (
    `(function () { window.dispatchEvent(new CustomEvent(${JSON.stringify(BRIDGE_EVENT)}, ` +
    `{ detail: ${serializeForScript(message)} })); })();\ntrue;`
  )
}

/** Badge first, then the consumer's own script. Separators keep trailing comments harmless. */
export function composeInjectedScript(info: AppInfo, consumerScript?: string): string {
  return [buildBadgeScript(info), consumerScript ?? '', 'true;'].join('\n;\n')
}
```

- [ ] **Step 8: Write the failing test `test/app-info.test.ts`**

```ts
import { expect, test } from 'bun:test'
import { resolveAppInfo } from '../src/native/app-info'

test('reads version and platform-specific build number', () => {
  const config = { version: '2.1.0', ios: { buildNumber: '15' }, android: { versionCode: 33 } }
  expect(resolveAppInfo('ios', config)).toEqual({ platform: 'ios', appVersion: '2.1.0', buildNumber: '15' })
  expect(resolveAppInfo('android', config)).toEqual({ platform: 'android', appVersion: '2.1.0', buildNumber: '33' })
})

test('falls back when config is missing and applies overrides', () => {
  expect(resolveAppInfo('ios', null)).toEqual({ platform: 'ios', appVersion: '0.0.0', buildNumber: '0' })
  expect(resolveAppInfo('android', undefined, { appVersion: '9.9.9' })).toMatchObject({ platform: 'android', appVersion: '9.9.9' })
})
```

- [ ] **Step 9: Implement `src/native/app-info.ts`**

```ts
import type { AppInfo, Platform } from '../shared/protocol'

export interface ExpoConfigLike {
  version?: string
  ios?: { buildNumber?: string }
  android?: { versionCode?: number }
}

export function resolveAppInfo(
  platformOS: string,
  expoConfig: ExpoConfigLike | null | undefined,
  override: Partial<AppInfo> = {},
): AppInfo {
  const platform: Platform = platformOS === 'android' ? 'android' : 'ios'
  const buildNumber =
    platform === 'ios' ? expoConfig?.ios?.buildNumber : expoConfig?.android?.versionCode?.toString()

  return {
    platform,
    appVersion: expoConfig?.version ?? '0.0.0',
    buildNumber: buildNumber ?? '0',
    ...override,
  }
}
```

- [ ] **Step 10: Run `bun test && bun run typecheck`**. Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add src/native/router.ts src/native/scripts.ts src/native/app-info.ts test/router.test.ts test/scripts.test.ts test/app-info.test.ts
git commit -m "feat(native): add message routing, injected scripts and app info

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Emitter queue (native core)

**Files:**
- Create: `src/native/emitter.ts`
- Test: `test/emitter.test.ts`

**Interfaces:**
- Consumes: `buildDispatchScript` (Task 4).
- Produces:
  - `interface BridgeEmitter { emit(name: string, data?: unknown): void; /** @internal */ connect(send: (script: string) => void): () => void; /** @internal */ setReady(ready: boolean): void }`
  - `createEmitterCore(): BridgeEmitter`

- [ ] **Step 1: Write the failing test `test/emitter.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'
import { createEmitterCore } from '../src/native/emitter'

function names(scripts: string[]) {
  return scripts.map((s) => /"name":"([^"]+)"/.exec(s)?.[1])
}

describe('createEmitterCore', () => {
  test('queues events until connected and ready, then flushes in order', () => {
    const emitter = createEmitterCore()
    const sent: string[] = []
    emitter.emit('a')
    emitter.connect((s) => sent.push(s))
    emitter.emit('b', { x: 1 })
    expect(sent).toHaveLength(0)
    emitter.setReady(true)
    expect(names(sent)).toEqual(['a', 'b'])
    emitter.emit('c')
    expect(names(sent)).toEqual(['a', 'b', 'c'])
  })

  test('queues again while the page reloads and never duplicates', () => {
    const emitter = createEmitterCore()
    const sent: string[] = []
    emitter.connect((s) => sent.push(s))
    emitter.setReady(true)
    emitter.emit('before')
    emitter.setReady(false) // onLoadStart of a reload
    emitter.emit('during')
    expect(names(sent)).toEqual(['before'])
    emitter.setReady(true) // onLoadEnd
    expect(names(sent)).toEqual(['before', 'during'])
    emitter.setReady(true)
    expect(names(sent)).toEqual(['before', 'during'])
  })

  test('disconnect stops sending and keeps queuing without throwing', () => {
    const emitter = createEmitterCore()
    const sent: string[] = []
    const disconnect = emitter.connect((s) => sent.push(s))
    emitter.setReady(true)
    disconnect()
    expect(() => emitter.emit('queued')).not.toThrow()
    expect(sent).toHaveLength(0)
    const later: string[] = []
    emitter.connect((s) => later.push(s))
    emitter.setReady(true)
    expect(names(later)).toEqual(['queued'])
  })

  test('a stale disconnect does not detach a newer connection', () => {
    const emitter = createEmitterCore()
    const first: string[] = []
    const second: string[] = []
    const disconnectFirst = emitter.connect((s) => first.push(s))
    emitter.connect((s) => second.push(s))
    disconnectFirst()
    emitter.setReady(true)
    emitter.emit('x')
    expect(first).toHaveLength(0)
    expect(names(second)).toEqual(['x'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/emitter.test.ts`
Expected: FAIL with `Cannot find module '../src/native/emitter'`.

- [ ] **Step 3: Implement `src/native/emitter.ts`**

```ts
import type { EventMessage } from '../shared/protocol'
import { buildDispatchScript } from './scripts'

export interface BridgeEmitter {
  /** Sends an event to the page. Queued until the page has finished loading. */
  emit(name: string, data?: unknown): void
  /** @internal Called by BridgeWebView. */
  connect(send: (script: string) => void): () => void
  /** @internal Called by BridgeWebView on load start (false) and load end (true). */
  setReady(ready: boolean): void
}

export function createEmitterCore(): BridgeEmitter {
  const queue: EventMessage[] = []
  let send: ((script: string) => void) | null = null
  let ready = false

  function flush() {
    if (!send || !ready) return
    while (queue.length > 0) send(buildDispatchScript(queue.shift()!))
  }

  return {
    emit(name, data) {
      const message: EventMessage = { bridge: 1, kind: 'evt', name }
      if (data !== undefined) message.data = data
      queue.push(message)
      flush()
    },

    connect(nextSend) {
      send = nextSend
      flush()
      return () => {
        if (send !== nextSend) return
        send = null
        ready = false
      }
    },

    setReady(value) {
      ready = value
      flush()
    },
  }
}
```

- [ ] **Step 4: Run `bun test && bun run typecheck`**. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/native/emitter.ts test/emitter.test.ts
git commit -m "feat(native): add emitter that queues events until the page is ready

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `BridgeWebView`, native entry, build and CI

**Files:**
- Create: `src/native/BridgeWebView.tsx`, `src/native/useBridgeEmitter.ts`, `src/native/index.ts`
- Create: `tsup.config.ts`, `scripts/check-dist.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes:
  - `routeMessage`, `Handlers` (Task 4)
  - `composeNavigationHandler` (Task 3)
  - `composeInjectedScript`, `buildDispatchScript`, `resolveAppInfo` (Task 4)
  - `createEmitterCore`, `BridgeEmitter` (Task 5)
- Produces (public `/native`):
  - `BridgeWebView` (forwardRef to `WebView`)
  - `BridgeWebViewProps`
  - `useBridgeEmitter(): BridgeEmitter`
  - types `BridgeEmitter`, `Handler`, `Handlers`, `AppInfo`

`BridgeWebView` has no unit test. Its logic is already covered by Tasks 3 to 5, and the wiring is verified on the simulator in Task 8. This task's automated gate is typecheck, build and `check:dist`.

- [ ] **Step 1: Implement `src/native/useBridgeEmitter.ts`**

```ts
import { useRef } from 'react'
import { createEmitterCore, type BridgeEmitter } from './emitter'

/** Stable emitter for sending events to the page. Pass it to <BridgeWebView emitter={...} />. */
export function useBridgeEmitter(): BridgeEmitter {
  const ref = useRef<BridgeEmitter | null>(null)
  if (ref.current === null) ref.current = createEmitterCore()
  return ref.current
}
```

- [ ] **Step 2: Implement `src/native/BridgeWebView.tsx`**

```tsx
import { forwardRef, useCallback, useEffect, useMemo, useRef, type ForwardedRef } from 'react'
import { Linking, Platform } from 'react-native'
import Constants from 'expo-constants'
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview'
import type { AppInfo } from '../shared/protocol'
import { resolveAppInfo } from './app-info'
import type { BridgeEmitter } from './emitter'
import { composeNavigationHandler } from './navigation'
import { routeMessage, type Handlers } from './router'
import { buildDispatchScript, composeInjectedScript } from './scripts'

type ShouldStartLoadRequest = Parameters<NonNullable<WebViewProps['onShouldStartLoadWithRequest']>>[0]

export interface BridgeWebViewProps
  extends Omit<
    WebViewProps,
    | 'onShouldStartLoadWithRequest'
    | 'injectedJavaScriptForMainFrameOnly'
    | 'injectedJavaScriptBeforeContentLoadedForMainFrameOnly'
  > {
  /** Hostnames allowed to call handlers and to load inside the WebView. `*.x.com` matches subdomains. */
  trustedHosts: readonly string[]
  /** Hostnames that load inside the WebView WITHOUT bridge access (file previews, OAuth, 3-D Secure). */
  inAppHosts?: readonly string[]
  /** Methods the page can call with `bridge.call(method, params)`. */
  handlers?: Handlers
  /** From `useBridgeEmitter()`, to send events to the page. */
  emitter?: BridgeEmitter
  /** Overrides for the badge values read from expo-constants. */
  appInfo?: Partial<AppInfo>
  /** Runs before the default policy. Return true/false to decide, or undefined to fall back to it. */
  onShouldStartLoadWithRequest?: (request: ShouldStartLoadRequest) => boolean | undefined
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

export const BridgeWebView = forwardRef<WebView, BridgeWebViewProps>(function BridgeWebView(props, ref) {
  const {
    trustedHosts,
    inAppHosts,
    handlers,
    emitter,
    appInfo,
    onMessage,
    onShouldStartLoadWithRequest,
    injectedJavaScriptBeforeContentLoaded,
    onLoadStart,
    onLoadEnd,
    ...webViewProps
  } = props

  const webViewRef = useRef<WebView | null>(null)
  const handlersRef = useRef<Handlers>(handlers ?? {})
  const trustedHostsRef = useRef(trustedHosts)
  const inAppHostsRef = useRef<readonly string[]>(inAppHosts ?? [])
  handlersRef.current = handlers ?? {}
  trustedHostsRef.current = trustedHosts
  inAppHostsRef.current = inAppHosts ?? []

  const setRef = useCallback(
    (instance: WebView | null) => {
      webViewRef.current = instance
      assignRef(ref, instance)
    },
    [ref],
  )

  const send = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(script)
  }, [])

  useEffect(() => emitter?.connect(send), [emitter, send])

  const appInfoKey = JSON.stringify(appInfo ?? {})
  const injectedScript = useMemo(
    () =>
      composeInjectedScript(
        resolveAppInfo(Platform.OS, Constants.expoConfig, appInfo),
        injectedJavaScriptBeforeContentLoaded,
      ),
    // appInfoKey stands in for appInfo so a new object literal each render does not rebuild the script.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appInfoKey, injectedJavaScriptBeforeContentLoaded],
  )

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const { data, url } = event.nativeEvent
      const route = routeMessage(data, url, handlersRef.current, trustedHostsRef.current)
      if (route.type === 'forward') {
        onMessage?.(event)
        return
      }
      if (route.type === 'drop') {
        if (__DEV__) console.warn(`[mobile-app-bridge] dropped message (${route.reason}) from ${url}`)
        return
      }
      void route.response.then((response) => send(buildDispatchScript(response)))
    },
    [onMessage, send],
  )

  const handleShouldStart = useMemo(
    () =>
      composeNavigationHandler<ShouldStartLoadRequest>(
        onShouldStartLoadWithRequest,
        () => ({ trustedHosts: trustedHostsRef.current, inAppHosts: inAppHostsRef.current }),
        (url) => {
          Linking.openURL(url).catch(() => {})
        },
      ),
    [onShouldStartLoadWithRequest],
  )

  return (
    <WebView
      {...webViewProps}
      ref={setRef}
      onMessage={handleMessage}
      onShouldStartLoadWithRequest={handleShouldStart}
      injectedJavaScriptBeforeContentLoaded={injectedScript}
      injectedJavaScriptForMainFrameOnly
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      onLoadStart={(event) => {
        emitter?.setReady(false)
        onLoadStart?.(event)
      }}
      onLoadEnd={(event) => {
        emitter?.setReady(true)
        onLoadEnd?.(event)
      }}
    />
  )
})
```

- [ ] **Step 3: Implement `src/native/index.ts`**

```ts
export { BridgeWebView } from './BridgeWebView'
export type { BridgeWebViewProps } from './BridgeWebView'
export { useBridgeEmitter } from './useBridgeEmitter'
export type { BridgeEmitter } from './emitter'
export type { Handler, Handlers } from './router'
export type { AppInfo } from '../shared/protocol'
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: exit 0.

If `__DEV__` is reported as undeclared, add `src/native/globals.d.ts` containing `declare const __DEV__: boolean` and include it. If a prop name such as `injectedJavaScriptBeforeContentLoadedForMainFrameOnly` is missing from the installed `react-native-webview` typings, check `node_modules/react-native-webview/lib/WebViewTypes.d.ts`. Use the exact prop names it declares, and note the difference in the commit message.

- [ ] **Step 5: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'web/index': 'src/web/index.ts', 'native/index': 'src/native/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.js' : '.cjs' }),
})
```

Run: `bun add -d tsup@^8.5.1`

- [ ] **Step 6: Create `scripts/check-dist.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs'

const required = [
  'dist/web/index.js',
  'dist/web/index.cjs',
  'dist/web/index.d.ts',
  'dist/web/index.d.cts',
  'dist/native/index.js',
  'dist/native/index.cjs',
  'dist/native/index.d.ts',
  'dist/native/index.d.cts',
]
const missing = required.filter((file) => !existsSync(file))
if (missing.length > 0) throw new Error(`Missing build outputs: ${missing.join(', ')}`)

const forbidden = ['react-native', 'react-native-webview', 'expo-constants', "from 'react'", 'from "react"', "require('react')", 'require("react")']
for (const file of ['dist/web/index.js', 'dist/web/index.cjs']) {
  const source = readFileSync(file, 'utf8')
  const hit = forbidden.find((needle) => source.includes(needle))
  if (hit) throw new Error(`${file} must not reference ${hit}`)
}

const web = await import('../dist/web/index.js')
for (const name of ['bridge', 'createBridgeClient', 'BridgeError', 'ErrorCode']) {
  if (!(name in web)) throw new Error(`dist/web is missing export ${name}`)
}
console.log('dist OK')
```

- [ ] **Step 7: Build and check**

Run: `bun run build && bun run check:dist`
Expected: tsup reports both entries and the script prints `dist OK`.

- [ ] **Step 8: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.9'
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build
      - run: bun run check:dist
```

- [ ] **Step 9: Run the full gate**

Run: `bun run typecheck && bun test && bun run build && bun run check:dist`
Expected: everything passes.

- [ ] **Step 10: Commit**

```bash
git add src/native tsup.config.ts scripts/check-dist.ts .github/workflows/ci.yml package.json bun.lock
git commit -m "feat(native): add BridgeWebView, emitter hook, build and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Example web page and Expo app

**Files:**
- Create: `example/web/index.html`, `example/web/second.html`, `example/web/iframe.html`, `example/web/src/main.ts`, `example/web/serve.ts`
- Create: `example/app/` (generated by `create-expo-app`, then modified): `example/app/App.tsx`, `example/app/metro.config.js`, `example/app/handlers.ts`
- Modify: `package.json` (add `example:web` script)

**Interfaces:**
- Consumes: the built package (`dist/`) from Task 6. The web page imports `../../../dist/web/index.js`. The app imports `@rodrigocoliveira/mobile-app-bridge/native` through a `file:../..` dependency.
- Produces:
  - a web server at `http://localhost:5055` (trusted), whose `iframe.html` is also reachable as `http://127.0.0.1:5055/iframe.html` (untrusted)
  - an Expo Go app whose trusted hosts are `['localhost']` and whose in-app hosts are `['127.0.0.1']`

- [ ] **Step 1: Create `example/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mobile-app-bridge example</title>
    <!-- 14. Third-party script: must load without any allowlisting -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST000000"></script>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; margin: 16px; }
      button, a.button { display: block; width: 100%; margin: 6px 0; padding: 10px; font-size: 15px; cursor: pointer; text-align: center; }
      #status { padding: 8px; background: #eef; border-radius: 6px; }
      #log { font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; background: #111; color: #0f0; padding: 8px; min-height: 120px; }
      iframe { width: 100%; height: 90px; border: 1px dashed #999; }
    </style>
  </head>
  <body>
    <div id="status">loading…</div>
    <button data-action="echo">2. test.echo</button>
    <button data-action="camera">3. camera.requestPermission</button>
    <button data-action="haptics">4. haptics.impact</button>
    <button data-action="unsupported">5. app.unsupported</button>
    <button data-action="unknown">6a. unknown method</button>
    <button data-action="throw">6b. test.throw</button>
    <button data-action="timeout">7. timeout</button>
    <button data-action="legacy">11. legacy postMessage</button>
    <a class="button" href="https://example.com">10a. external link</a>
    <a class="button" href="/second.html">10b. same-host link</a>
    <a class="button" href="http://127.0.0.1:5055/second.html">15. inAppHosts link</a>
    <!-- 14. Third-party iframes: must render in place, never open the browser -->
    <iframe src="https://www.openstreetmap.org/export/embed.html?bbox=-46.66%2C-23.57%2C-46.62%2C-23.54&amp;layer=mapnik" title="map"></iframe>
    <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TEST000" title="gtm" style="height: 20px"></iframe>
    <iframe src="http://127.0.0.1:5055/iframe.html" title="untrusted iframe"></iframe>
    <div id="log"></div>
    <script type="module" src="/dist/main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `example/web/second.html`**

The same file serves scenario 10b (at `localhost`, which is trusted) and scenarios 15 and 16 (at `127.0.0.1`, which is in `inAppHosts`). The probe shows whether a bridge call from this origin is answered.

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>second</title></head>
  <body style="font-family: system-ui; margin: 16px">
    <h1 id="second">Second page</h1>
    <p id="host"></p>
    <p id="probe">bridge probe: running…</p>
    <a href="http://localhost:5055/" style="cursor: pointer">Back</a>
    <script type="module">
      import { bridge } from '/dist/web/index.js'
      document.getElementById('host').textContent = 'host=' + location.hostname + ' isApp=' + bridge.isApp
      bridge.call('test.echo', { from: 'second' }, { timeout: 1500 })
        .then((r) => { document.getElementById('probe').textContent = 'bridge probe: answered ' + JSON.stringify(r) })
        .catch((e) => { document.getElementById('probe').textContent = 'bridge probe: ' + e.code })
    </script>
  </body>
</html>
```

- [ ] **Step 3: Create `example/web/iframe.html`**

This page probes whether an untrusted iframe can reach a handler (spec §8.2 scenario 12).

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>iframe probe</title></head>
  <body style="font-family: ui-monospace, monospace; font-size: 11px; margin: 4px">
    <div id="probe">iframe probe: running…</div>
    <script>
      var out = document.getElementById('probe')
      var badge = !!window.__MOBILE_APP_BRIDGE__
      var rnwv = !!window.ReactNativeWebView
      var answered = false
      window.addEventListener('mobile-app-bridge', function (e) {
        if (e.detail && e.detail.id === 'iframe-probe') answered = true
      })
      if (rnwv) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ bridge: 1, kind: 'req', id: 'iframe-probe', method: 'test.echo', params: { from: 'iframe' } }))
      }
      setTimeout(function () {
        out.textContent = 'iframe probe: badge=' + badge + ' ReactNativeWebView=' + rnwv + ' answered=' + answered
      }, 2000)
    </script>
  </body>
</html>
```

- [ ] **Step 4: Create `example/web/src/main.ts`**

```ts
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

status.textContent = `1. isApp=${bridge.isApp} info=${JSON.stringify(bridge.info)} gtag=${typeof (window as unknown as { dataLayer?: unknown }).dataLayer !== 'undefined' || !!document.querySelector('script[src*="gtag"]')}`

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
  legacy: () => {
    const native = (window as unknown as { ReactNativeWebView?: { postMessage(m: string): void } }).ReactNativeWebView
    native?.postMessage(JSON.stringify({ event_name: 'legacyLogin' }))
    write(`11. legacy sent (inApp=${!!native})`)
  },
}

document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
  button.addEventListener('click', () => actions[button.dataset.action!]?.())
})
```

- [ ] **Step 5: Create `example/web/serve.ts`**

```ts
import { join } from 'node:path'

const root = import.meta.dir

await Bun.build({
  entrypoints: [join(root, 'src/main.ts')],
  outdir: join(root, 'dist'),
  target: 'browser',
})

Bun.serve({
  port: 5055,
  hostname: '0.0.0.0',
  async fetch(request) {
    const { pathname } = new URL(request.url)
    const path = pathname === '/' ? '/index.html' : pathname
    // /dist/web/* is the package build (used by second.html); everything else lives in example/web.
    const base = path.startsWith('/dist/web/') ? join(root, '../..') : root
    const file = Bun.file(join(base, path))
    return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 })
  },
})

console.log('example web on http://localhost:5055 (trusted) and http://127.0.0.1:5055 (untrusted)')
```

Add to the root `package.json` scripts: `"example:web": "bun run build && bun run example/web/serve.ts"`.

Run: `bun run example:web` in the background, then `curl -s http://localhost:5055/ | grep -c data-action`.
Expected: `8`. Stop the server afterwards.

- [ ] **Step 6: Generate the Expo SDK 57 app**

Run:
```bash
cd example && npx create-expo-app@latest app --template blank-typescript@sdk-57 --no-install && cd app && npm install
npx expo install react-native-webview expo-camera expo-haptics expo-constants
npm install ../..
```
Expected:
- `example/app/package.json` lists `expo` `~57.x`
- `react-native-webview` `13.16.1`
- `"@rodrigocoliveira/mobile-app-bridge": "file:../.."`

If the `@sdk-57` template tag is rejected, run `npx create-expo-app@latest app --template blank-typescript --no-install` and confirm that `expo` is `57.x` in the generated `package.json`.

- [ ] **Step 7: Create `example/app/metro.config.js`**

This lets Metro follow the `file:../..` symlink without loading a second copy of React from the library's own `node_modules`.

```js
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const libraryRoot = path.resolve(projectRoot, '../..')
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [libraryRoot]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.disableHierarchicalLookup = true
config.resolver.blockList = [new RegExp(`^${escape(path.join(libraryRoot, 'node_modules'))}\\/.*`)]

module.exports = config
```

- [ ] **Step 8: Create `example/app/handlers.ts`**

```ts
import { Alert, Linking } from 'react-native'
import { Camera } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import type { Handlers } from '@rodrigocoliveira/mobile-app-bridge/native'

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const

export const handlers: Handlers = {
  'test.echo': async (params: { from?: string } | undefined) => {
    if (params?.from === 'iframe') Alert.alert('SECURITY', 'An untrusted iframe reached a handler')
    return params
  },

  'test.sleep': ({ ms }: { ms: number }) => new Promise((resolve) => setTimeout(() => resolve({ slept: ms }), ms)),

  'test.throw': async () => {
    throw Object.assign(new Error('Thrown on purpose'), { code: 'CUSTOM' })
  },

  'camera.requestPermission': async () => {
    const current = await Camera.getCameraPermissionsAsync()
    if (current.granted) return { granted: true }
    if (!current.canAskAgain) {
      await Linking.openSettings()
      return { granted: false, openedSettings: true }
    }
    const { granted } = await Camera.requestCameraPermissionsAsync()
    return { granted }
  },

  'haptics.impact': async ({ style = 'light' }: { style?: keyof typeof IMPACT } = {}) => {
    await Haptics.impactAsync(IMPACT[style])
    return { style }
  },

  'app.unsupported': async ({ feature }: { feature: string }) => {
    Alert.alert('Not available in the app', `${feature} is only available on the website, on a computer.`)
  },
}
```

- [ ] **Step 9: Replace `example/app/App.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, Text, View } from 'react-native'
import type { WebView } from 'react-native-webview'
import { BridgeWebView, useBridgeEmitter } from '@rodrigocoliveira/mobile-app-bridge/native'
import { handlers } from './handlers'

const WEB_URL = 'http://localhost:5055/'

export default function App() {
  const emitter = useBridgeEmitter()
  const webViewRef = useRef<WebView>(null)
  const [legacyMessage, setLegacyMessage] = useState<string | null>(null)

  useEffect(() => {
    // Emitted before the page exists: exercises the queue + in-page buffer.
    emitter.emit('test.early', { at: Date.now() })
  }, [emitter])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => emitter.emit('app.stateChange', { state }))
    return () => subscription.remove()
  }, [emitter])

  return (
    <View style={styles.container}>
      {legacyMessage && <Text style={styles.banner}>Legacy onMessage: {legacyMessage}</Text>}
      <BridgeWebView
        ref={webViewRef}
        emitter={emitter}
        source={{ uri: WEB_URL }}
        trustedHosts={['localhost']}
        inAppHosts={['127.0.0.1']}
        handlers={handlers}
        onMessage={(event) => setLegacyMessage(event.nativeEvent.data)}
        style={styles.webview}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 54, backgroundColor: '#fff' },
  banner: { padding: 8, backgroundColor: '#ffd', fontSize: 12 },
  webview: { flex: 1 },
})
```

- [ ] **Step 10: Typecheck the example app**

Run: `cd example/app && npx tsc --noEmit`
Expected: exit 0. This proves that the published types resolve through the `exports` map.

- [ ] **Step 11: Commit**

```bash
git add example package.json
git commit -m "chore(example): add Expo SDK 57 app and web test page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end verification on the iOS simulator and Android emulator

**Files:**
- Create: `docs/e2e-results.md`

**Interfaces:**
- Consumes: the example web server and the Expo app from Task 7.

This task is run by Claude with the iOS simulator tools (`mcp__Claude_Code_iOS_Simulator__control`: `attach`, `screenshot`, `tap`, `button`). Tap coordinates always come from the latest screenshot.

- [ ] **Step 1: Start the web server and the app**
  - Run `bun run example:web` in the background.
  - Boot an iPhone simulator (for example `xcrun simctl boot "iPhone 15 Pro"`).
  - Call the simulator tool `attach`.
  - Run `cd example/app && npx expo start --ios` in the background. Expo installs Expo Go on the simulator and opens the app.
  - Take a screenshot. Expected: the example page shows `1. isApp=true info={"platform":"ios",...}`.

- [ ] **Step 2: Run the scenarios from spec §8.2 in order.** Take a screenshot after each tap, then check the top line of the log.

| # | Action | Expected |
|---|---|---|
| 1 | (initial screen) | `isApp=true`, platform `ios`, a version is shown |
| 8 | (initial screen) | `8. test.early received {...}` appears exactly once |
| 2 | tap `2. test.echo` | `ok {"hello":"world","n":42}` |
| 3 | tap `3. camera…` | the iOS permission dialog appears; after "Allow", `ok {"granted":true}` |
| 4 | tap `4. haptics.impact` | `ok {"style":"medium"}` |
| 5 | tap `5. app.unsupported` | a native alert "Not available in the app" appears; dismiss it, then `ok undefined` |
| 6a | tap `6a` | `error UNKNOWN_METHOD` |
| 6b | tap `6b` | `error CUSTOM: Thrown on purpose` |
| 7 | tap `7. timeout` | `error TIMEOUT` after about 0.5s |
| 11 | tap `11. legacy` | a native banner shows `Legacy onMessage: {"event_name":"legacyLogin"}` |
| 12 | (iframe box) | after 2s, the text shows `answered=false`, and no "SECURITY" alert appeared |
| 9 | press HOME, then reopen Expo Go from the app switcher | `9. app.stateChange {"state":"background"}` and then `{"state":"active"}` |
| 10a | tap `10a. external link` | Safari opens `example.com`; return to Expo Go |
| 10b | tap `10b. same-host link` | "Second page (same host)" loads inside the app |
| 14 | (initial screen) | the map iframe renders, the GTM iframe box is present, `gtag=true`, and nothing opened Safari |
| 15 | tap `15. inAppHosts link` | "Second page" with `host=127.0.0.1` loads **inside the app** |
| 16 | (on that page, wait 2s) | `bridge probe: TIMEOUT` (the native side dropped the untrusted call); tap Back |
| 10b′ | tap `10b. same-host link` again | the probe shows `answered {"from":"second"}` (trusted origin) |
| 13 | open `http://localhost:5055` in the simulator's Safari (`xcrun simctl openurl booted http://localhost:5055`), tap `2. test.echo` | `isApp=false`, `error NOT_IN_APP` |

- [ ] **Step 3: Record the open question from spec scenario 12.** Write down the iframe probe's `badge`, `ReactNativeWebView` and `answered` values.
  - If a "SECURITY" alert appeared, or `answered=true`, then the host check is not enough for subframes. Record that, and add a limitation note to the README in Task 9: "Do not embed untrusted iframes on bridge-enabled pages".
  - If `answered=false` and there was no alert, record that the subframe request was dropped.

- [ ] **Step 3b: Repeat on the Android emulator**

There is no dedicated Android tool, so drive the emulator with `adb`:
- **Boot:** `~/Library/Android/sdk/emulator/emulator -avd Pixel_3a_API_35_extension_level_13_arm64-v8a -no-snapshot-save &`, then `adb wait-for-device`.
- **Make localhost reach the Mac:** `adb reverse tcp:5055 tcp:5055`. Keep the web server running.
- **Start the app:** `cd example/app && npx expo start --android` (in the background). This installs Expo Go and sets up the Metro reverse.
- **Look:** `adb exec-out screencap -p > /tmp/android.png`, then read the PNG.
- **Tap:** `adb shell input tap X Y`, using pixel coordinates from that screenshot.
- **Other input:**
  - Home: `adb shell input keyevent KEYCODE_HOME`
  - App switcher: `adb shell input keyevent KEYCODE_APP_SWITCH`
  - Back: `adb shell input keyevent KEYCODE_BACK`
- **Scenario 13:** `adb shell am start -a android.intent.action.VIEW -d http://localhost:5055`, which opens Chrome.

Run every row of the Step 2 table. Android differences to watch for and record:
- Scenario 3 shows the Android permission dialog.
- Scenario 14 is the key one, because Android does not send `isTopFrame`, so check whether any iframe was pushed to Chrome.
- Scenario 12: record whether `ReactNativeWebView` exists inside the iframe on Android.

- [ ] **Step 4: Write `docs/e2e-results.md`**

Include:
- the date
- the simulator model and iOS version (`xcrun simctl list devices booted`)
- the Expo SDK and Expo Go version
- the Android emulator image and API level
- a table with one row per scenario and two result columns, iOS and Android (# / iOS PASS or FAIL / Android PASS or FAIL / note)
- the scenario 12 finding

For any FAIL, stop and report it to the user with the screenshot. Do not paper over it.

- [ ] **Step 5: Stop the servers, then commit**

```bash
git add docs/e2e-results.md
git commit -m "docs: record iOS simulator end-to-end results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: README, release automation and handoff

**Files:**
- Create: `README.md`, `RELEASING.md`, `.changeset/config.json`, `.changeset/initial-release.md`, `.github/workflows/release.yml`

- [ ] **Step 1: Create `README.md`**

It must contain, in this order:
1. A one-paragraph intent (§1 of the spec).
2. Install: `npm i @rodrigocoliveira/mobile-app-bridge`. The native side also needs `npx expo install react-native-webview expo-constants`.
3. **Web usage**: `bridge.isApp`, `bridge.info`, `bridge.call` (with the `BridgeError` codes table from spec §4, including `INVALID_PARAMS`), and `bridge.on` (with the 10s replay note).
4. **Native usage**: the `BridgeWebView` example from spec §5, and the prop composition table from §5.2.
5. **Security**: host matching rules, the default navigation policy (§6), and the scenario 12 finding from `docs/e2e-results.md`.
6. **Migrating from a legacy bridge**: non-bridge messages still reach your `onMessage`. Use a two-line Agendart `{ event_name }` example.
7. **Running the example**: `bun run example:web`, then `cd example/app && npx expo start --ios`.

- [ ] **Step 2: Create `.changeset/config.json`**

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.2/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 3: Create `.changeset/initial-release.md`**

```md
---
"@rodrigocoliveira/mobile-app-bridge": minor
---

Initial release: promise-based `bridge.call` / `bridge.on` for the web page, and `BridgeWebView` / `useBridgeEmitter` for the Expo app.
```

- [ ] **Step 4: Create `.github/workflows/release.yml`**

Copy `/Users/rodrigocasagrande/Documents/Development/multek/open-source-packages/agno-frontend-sdk/.github/workflows/release.yml` verbatim, with two changes:
- Keep `script: bun run version` in the version job and `script: bun run release` in the publish job. Both scripts exist in this repo's `package.json`.
- Change the header comment's reference from "both packages" to "the package".

- [ ] **Step 5: Create `RELEASING.md`**

Adapt `agno-frontend-sdk/RELEASING.md` to a single package, `@rodrigocoliveira/mobile-app-bridge`. Add a "First release" section with these steps, all performed by the user:
1. Create the GitHub repo `rodrigocoliveira/mobile-app-bridge` and push `main`.
2. Run `bun run version` (consumes `.changeset/initial-release.md`, bumping `0.0.0` → `0.1.0`), commit and push. Then `npm login` and, from that clean checkout, run `bun install && bun run build && bun run check:dist && npm publish --access public` once.
3. On npmjs.com, open the package settings, go to "Trusted publisher", and add GitHub Actions with repo `rodrigocoliveira/mobile-app-bridge` and workflow `release.yml`.
4. From then on, releases go through changesets PRs.

- [ ] **Step 6: Final gate**

Run: `bun install --frozen-lockfile && bun run typecheck && bun test && bun run build && bun run check:dist && npm pack --dry-run`
Expected: everything passes. `npm pack --dry-run` lists only `dist/**`, `README.md`, `LICENSE` and `package.json`.

- [ ] **Step 7: Commit**

```bash
git add README.md RELEASING.md .changeset .github/workflows/release.yml
git commit -m "docs: add README, release automation and first-release guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Handoff (no outward action)**

Tell the user that the package is ready locally. Summarise the results from `docs/e2e-results.md`. Then ask whether they want Claude to create the GitHub repo and push. The npm login, first publish and trusted-publisher setup stay with the user (see `RELEASING.md`).
