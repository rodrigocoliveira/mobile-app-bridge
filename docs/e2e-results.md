# End-to-end results — v0.1

- **Date:** 2026-09-30
- **App:** `example/app`, which runs in Expo Go. Versions: Expo SDK 57.0.26, react-native 0.86.3, react-native-webview 13.16.1.
- **Web:** `example/web`. It is served on `http://localhost:5055` (in `trustedHosts`) and `http://127.0.0.1:5055` (in `inAppHosts`, and also used as the untrusted iframe origin).
- **iOS:** iPhone 17 Pro simulator, iOS 26.5, driven with the Claude Code iOS simulator tool.
- **Android:** `Pixel_3a_API_35` emulator (`sdk_gphone64_arm64`, Android 15), driven with `adb` (`screencap`, `input tap`, `adb reverse tcp:5055` / `tcp:8081`).

| # | Scenario | iOS | Android | Notes |
|---|---|---|---|---|
| 1 | Badge / `isApp` / info | PASS | PASS (after fix) | Android originally failed intermittently. See "Android injection race" below. |
| 2 | `test.echo` round-trip | PASS | PASS | `{"hello":"world","n":42}` |
| 3 | `camera.requestPermission` | PASS | PASS | The native permission dialog was shown and the call resolved `{"granted":true}`. |
| 4 | `haptics.impact` | PASS | PASS | Resolved `{"style":"medium"}`. Simulators do not vibrate. |
| 5 | `app.unsupported` | PASS | PASS | Native alert shown |
| 6a | Unknown method | PASS | PASS | `UNKNOWN_METHOD` |
| 6b | Handler throws `{ code: 'CUSTOM' }` | PASS | PASS | `CUSTOM: Thrown on purpose` |
| 7 | Timeout | PASS | PASS | `TIMEOUT` after 500 ms |
| 8 | Event emitted before page load | PASS | PASS | `test.early` delivered exactly once. It was also delivered exactly once after the badge-script re-run was added. |
| 9 | `app.stateChange` | PASS | PASS | iOS: `inactive` → `background` → `active`. Android: `background` → `active`. |
| 10a | External link | PASS | PASS | Safari / Chrome opened `example.com` |
| 10b | Same-host link | PASS | PASS | Loaded in the app, and the page's bridge call was answered. |
| 11 | Legacy `{ event_name }` message | PASS | PASS | It reached the consumer `onMessage` banner. |
| 12 | Untrusted iframe | PASS | PASS | See "Scenario 12 finding" below. |
| 13 | Page outside the app | PASS | NOT RUN | iOS Safari showed `isApp=false` and `NOT_IN_APP`. Android Chrome stopped at its first-run screen, which requires accepting Google's Terms of Service. That was not accepted on the user's behalf. The same behavior is covered by the iOS run and by unit tests. |
| 14 | GA script + third-party iframes | PASS | PASS | `gtag.js` loaded, the OpenStreetMap iframe rendered, the GTM `ns.html` iframe was present, and nothing was sent to the browser. |
| 15 | `inAppHosts` link | PASS | PASS | `127.0.0.1` page loaded inside the app |
| 16 | Bridge call from an `inAppHosts` page | PASS | PASS | `TIMEOUT`: the native side dropped it (`untrusted-origin`). That page still sees `isApp=true`, because the badge and user-agent are present, but it cannot call handlers. |

## Scenario 12 finding (the spec's open question)

**iOS:**
- The iframe has neither the badge nor `window.ReactNativeWebView`.
- `answered=false`, and no "SECURITY" alert was shown.

**Android:**
- The iframe **does** have `window.ReactNativeWebView`. react-native-webview registers a `WebMessageListener` for all origins (`*`).
- Its message was dropped with `untrusted-origin`, and the iframe got `answered=false`.
- Android reports the **sending frame's origin** (`sourceOrigin`, e.g. `http://127.0.0.1:5055`) as `nativeEvent.url`. That is why the host check stops subframes on Android.

**Conclusion:** the origin check is effective for iframes on both platforms. An iframe served from a **trusted** host, however, could call handlers on Android. The README states that.

## Android injection race (found and fixed during this run)

**Symptom.** On Android the page intermittently showed `isApp=false`. Over 7 cold starts, `window.ReactNativeWebView` was present 7 times, but `window.__MOBILE_APP_BRIDGE__` was missing once.

**Root cause.** react-native-webview 13.16.1 on Android injects `injectedJavaScriptBeforeContentLoaded` from `onPageStarted` via `evaluateJavascript`. That call races with document creation (`RNCWebViewClient.onPageStarted` → `RNCWebView.callInjectedJavaScriptBeforeContentLoaded`).

**Fix, in this package (commit `824850e`):**
- `BridgeWebView` appends `MobileAppBridge/1 (<platform>; <appVersion>; <buildNumber>)` to the user-agent through `applicationNameForUserAgent`. The user-agent is set natively before any load, so it has no race. The web client falls back to it when the badge is missing.
- The badge script is idempotent and runs again as `injectedJavaScript` after load. That way the in-page event buffer exists even when the first injection is lost.

**Re-measured.** Over 7 cold starts, `isApp=true` 7 times, while the badge was still lost once. On iOS, calls and the early event still worked, and nothing was duplicated.

A side effect: backends can now detect the app from the `User-Agent` header.
