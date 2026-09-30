# @rodrigocoliveira/mobile-app-bridge

Build features once in your web app, and let the Expo WebView shell that loads it do the native parts.

This package is a small, promise-based bridge between a web page and the Expo app that renders it in a `react-native-webview`. The page calls `await bridge.call('camera.requestPermission')`, and the app runs the native handler you registered and answers.

It is a cleaned-up version of the bridge that ran in production in the Agendart app. It uses the same `postMessage` / `injectJavaScript` / `CustomEvent` mechanics, and adds request/response correlation, strict host matching and a fix for Android's injection race.

## Install

```bash
npm i @rodrigocoliveira/mobile-app-bridge
```

The web side has no dependencies. The Expo app also needs:

```bash
npx expo install react-native-webview expo-constants
```

## Web usage (`/web`)

```ts
import { bridge, BridgeError } from '@rodrigocoliveira/mobile-app-bridge/web'

bridge.isApp   // true inside the app (window.ReactNativeWebView exists)
bridge.info    // { platform: 'ios' | 'android', appVersion, buildNumber }, or null if the badge is missing

const { granted } = await bridge.call<{ granted: boolean }>('camera.requestPermission')
await bridge.call('billing.purchase', { productId: 'pro' }, { timeout: 120_000 }) // default 30s; 0 disables

const off = bridge.on('push.opened', (data) => { /* ... */ })
off()
```

- **SSR-safe:** importing the module never touches `window`.
- **Events are fire-and-forget.** `bridge.on` only receives events that arrive while it is subscribed.
- **Pull, don't push.** Anything that must not be lost is a method the page calls when it is ready. For example, the notification that opened the app:

  ```ts
  // app: store it at startup, expose it as a handler
  handlers={{ 'push.getInitial': async () => initialNotification }}
  // page: ask on boot (and again after any reload)
  const notification = await bridge.call('push.getInitial')
  ```

`call()` rejects with a `BridgeError` whose `code` is one of the following:

| Code | When |
|---|---|
| `NOT_IN_APP` | Called outside the app. It rejects immediately and nothing is sent. |
| `TIMEOUT` | No response within `timeout` |
| `UNKNOWN_METHOD` | This app build has no handler for the method |
| `HANDLER_ERROR` | The handler threw without a `code`, or returned something that is not JSON-serializable |
| `INVALID_PARAMS` | `params` cannot be JSON-serialized. It rejects immediately and nothing is sent. |
| *anything else* | The `code` your handler threw, for example `throw Object.assign(new Error('...'), { code: 'CANCELLED' })` |

## Native usage (`/native`)

```tsx
import { BridgeWebView, useBridgeEmitter } from '@rodrigocoliveira/mobile-app-bridge/native'

export default function Main() {
  const emitter = useBridgeEmitter() // optional; only needed to send events to the page

  return (
    <BridgeWebView
      source={{ uri: 'https://app.brand.com' }}
      emitter={emitter}
      trustedHosts={['app.brand.com', '*.brand.com']}           // load in the app AND may call handlers
      inAppHosts={['*.amazonaws.com', 'accounts.google.com']}  // load in the app, NO bridge access
      handlers={{
        'camera.requestPermission': async () => ({ granted: true }),
        'haptics.impact': async ({ style }) => { /* ... */ },
      }}
    />
  )
}

// anywhere: emitter.emit('app.stateChange', { state })  // sent now; dropped if no page is there
```

`BridgeWebView` accepts every `WebView` prop. It never silently overrides a prop you pass:

| Prop | Behavior |
|---|---|
| `onMessage` | Bridge messages are consumed. **Every other message is forwarded to your `onMessage`.** |
| `onShouldStartLoadWithRequest` | Yours runs first. Return `true`/`false` to decide, or `undefined` to use the default policy. |
| `injectedJavaScriptBeforeContentLoaded` | The bridge badge first, then your script |
| `injectedJavaScript` | The badge again (idempotent), then your script |
| `injectedJavaScriptForMainFrameOnly` | Always `true`. It cannot be overridden. |
| `ref` | Forwarded to the underlying `WebView` (`reload`, `goBack`, …) |

## Security and navigation

- **Hosts are matched exactly on the hostname.** `*.brand.com` matches subdomains, but not `brand.com` itself and not `evilbrand.com`. URL tricks such as `https://app.brand.com@evil.io` or `https://evil.io\@app.brand.com` resolve to the real host.
- **Only `trustedHosts` can call handlers.** Messages from any other origin are dropped (with a warning in `__DEV__`).
- **Only `trustedHosts` pages receive responses and events.** Every native-to-page delivery re-checks `location.hostname` in-page, so an `inAppHosts` or third-party page never sees push payloads.
- **Default navigation policy:**
  1. An http(s) URL on a `trustedHosts` or `inAppHosts` host loads in the app.
  2. Any http(s) **iframe** loads in place. This keeps reCAPTCHA, maps, GTM and payment widgets working.
  3. `about:`, `blob:`, `file:`, `javascript:` and `data:` in the top frame are blocked.
  4. Everything else opens outside the app (`Linking.openURL`), including other hosts, `tel:`, `mailto:` and `whatsapp:`.
- **Scripts, `fetch` and images are never affected.** Google Analytics and similar tools need no allowlisting.
- **Iframes.**
  - On iOS, iframes do not get `window.ReactNativeWebView` at all.
  - On Android they do, but their messages carry the iframe's own origin and are dropped unless that origin is trusted.
  - **So never embed pages from a trusted host that you do not control.**
- **What `inAppHosts` pages can see.** They see `bridge.isApp === true`, because `window.ReactNativeWebView` exists in every page the WebView loads, but they cannot call handlers or receive events.

The results on both platforms are in [`docs/e2e-results.md`](docs/e2e-results.md).

## Migrating from a legacy bridge

Messages without the bridge marker still reach your own `onMessage`, so you can migrate one event at a time:

```tsx
<BridgeWebView
  handlers={{ 'camera.requestPermission': requestCameraPermission }} // migrated
  onMessage={(e) => { const { event_name } = JSON.parse(e.nativeEvent.data); /* legacy events */ }}
  trustedHosts={['app.agendart.com.br']}
/>
```

## Running the example

```bash
bun install
bun run example:web          # builds the package, serves example/web on :5055
```

Then, in another terminal:

```bash
cd example/app && npm install && npx expo start --ios   # or --android (run `adb reverse tcp:5055 tcp:5055` first)
```

The full recipe for running the scenarios on the iOS simulator and Android emulator (including how Claude Code drives them) is in [`docs/device-testing.md`](docs/device-testing.md). In Claude Code, `/device-e2e` runs it.

## License

MIT
