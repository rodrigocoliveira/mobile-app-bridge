# End-to-end results — v0.1

- **Date:** 2026-09-30
- **Final design:** `isApp` = `window.ReactNativeWebView` exists; `emit` is immediate (no queue); data that must not be lost is pulled.
- **App:** `example/app` in Expo Go. Expo SDK 57.0.26, react-native 0.86.3, react-native-webview 13.16.1.
- **Web:** `example/web`, served on two hosts:
  - `http://localhost:5055` is in `trustedHosts`.
  - `http://127.0.0.1:5055` is in `inAppHosts`, and is also the untrusted iframe origin.
- **iOS:** iPhone 17 Pro simulator, iOS 26.5, driven with the Claude Code iOS simulator tool.
- **Android:** `Pixel_3a_API_35` emulator, Android 15, driven with `adb`.
- **Automated checks:** the page's **"Run automated checks"** button runs scenarios 2, 4, 6a, 6b, 7 and 8, verifies each result, and reports a summary to the dev server:

  ```
  auto platform=ios     2=PASS 4=PASS 6a=PASS 6b=PASS 7=PASS 8=PASS
  auto platform=android 2=PASS 4=PASS 6a=PASS 6b=PASS 7=PASS 8=PASS
  ```

## Results

"Visual" means the result was read from the page or a native dialog on screen, not from a report.

| # | Scenario | iOS | Android | How checked |
|---|---|---|---|---|
| 1 | `isApp` / info | PASS | PASS | Visual, plus page reports. On Android, 8 of 8 cold starts reported `isApp=true`. |
| 2 | `test.echo` round-trip | PASS | PASS | Automated |
| 3 | `camera.requestPermission` | PASS* | PASS | Visual. *iOS was checked in the first round (dialog shown, then `{"granted":true}`). Handler code is unchanged since. |
| 4 | `haptics.impact` | PASS | PASS | Automated. Simulators do not vibrate. |
| 5 | `app.unsupported` native alert | PASS* | PASS | Visual. *iOS was checked in the first round; code unchanged since. |
| 6a | Unknown method → `UNKNOWN_METHOD` | PASS | PASS | Automated |
| 6b | Handler throws `{ code: 'CUSTOM' }` | PASS | PASS | Automated |
| 7 | Timeout → `TIMEOUT` | PASS | PASS | Automated |
| 8 | Page pulls `app.getLaunchInfo` on boot | PASS | PASS | Automated and visual. On Android it was pulled again after a full reload, with the same value. |
| 9 | `app.stateChange` | PASS | PASS | Visual |
| 10a | External link opens the system browser | PASS* | PASS | *iOS first round; navigation code unchanged since. |
| 10b | Same-host link loads in the app, and its calls are answered | PASS* | PASS | *iOS first round |
| 11 | Legacy `{ event_name }` reaches the consumer `onMessage` | PASS | PASS | Visual (native banner) |
| 12 | Untrusted iframe cannot call handlers | PASS | PASS | Visual. See the note below. |
| 13 | Page outside the app → `isApp=false`, calls give `NOT_IN_APP` | PASS | NOT RUN | iOS Safari: automated checks returned `NOT_IN_APP` for every call. Android Chrome requires accepting Google's Terms on first run, which was not done on the user's behalf. |
| 14 | GA script and third-party iframes load in place | PASS | PASS | Visual (map rendered, `gtag=true`, nothing opened the browser) |
| 15 | `inAppHosts` link loads inside the app | PASS | PASS | Visual |
| 16 | Call from an `inAppHosts` page → `TIMEOUT` (dropped natively) | PASS | PASS | Visual |
| 17 | Events keep arriving after `history.pushState` (Inertia) | PASS | PASS | Visual: `pushState`, then background/foreground; `app.stateChange` arrived. |
| 18 | `inAppHosts` page never receives native deliveries | PASS | PASS | Visual. With `127.0.0.1/second.html` open, a background/foreground cycle delivered nothing. With the trusted `localhost/second.html` open, the same cycle delivered `app.stateChange` (positive control, Android). |

## Notes

**Iframes (scenario 12).**
- On iOS, iframes get neither the badge nor `window.ReactNativeWebView`.
- On Android they do get `window.ReactNativeWebView`. react-native-webview's `WebMessageListener` reports the iframe's own origin, so our origin check drops the message (`untrusted-origin`).

**Android badge race.** react-native-webview on Android injects `injectedJavaScriptBeforeContentLoaded` from `onPageStarted` via `evaluateJavascript`, which races with document creation. In an earlier round the badge was lost in 1 of 7 cold starts against a local page that loads in milliseconds. Two things now contain it:
- `isApp` no longer depends on the badge.
- The badge is injected again after load, so `info` is only `null` for a moment in the rare race.

**History.** Between the first and the final design, v0.1 had a user-agent fallback and a queue with an in-page buffer for early events. The queue got stuck after every Android `pushState`, which was reproduced here. Both were removed in favor of the Agendart-style `isApp` rule and the pull pattern.
