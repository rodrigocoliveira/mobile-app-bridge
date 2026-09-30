# Testing on the iOS simulator and Android emulator

Unit tests cover the protocol, the router and the web client. They cannot tell you whether a real
WebView injects the scripts, delivers messages and opens links the way we expect. For that we run
the example app on real simulators, and let Claude Code drive them.

This guide is the recipe. The last recorded run is in [`e2e-results.md`](e2e-results.md).

## The pieces

```
┌──────────── Mac ────────────┐        ┌──────── simulator / emulator ────────┐
│ example/web  (bun, :5055)   │◄──────►│ Expo Go                               │
│   index.html, second.html,  │  HTTP  │   example/app  (BridgeWebView)        │
│   iframe.html, /report      │        │     loads http://localhost:5055/      │
│ example/app  (Metro, :8081) │◄──────►│                                       │
└─────────────────────────────┘        └───────────────────────────────────────┘
```

| Piece | What it is |
|---|---|
| `example/web` | A static page with one button per scenario. `serve.ts` builds it and serves it on port 5055. It imports the package from `dist/`, so it always tests the current build. |
| `example/app` | An Expo SDK 57 app that runs in **Expo Go** (no native build). It depends on the package with `file:../..`, and `metro.config.js` watches the repo root. Handlers live in `handlers.ts`. |
| Two hosts, one server | `http://localhost:5055` is in `trustedHosts`. `http://127.0.0.1:5055` is in `inAppHosts`, and is also the "untrusted" iframe origin. Same server, different trust. |
| `/report` | The page `fetch`es `/report?...` and `serve.ts` prints it as `report ...`. This is how results reach the terminal without reading the screen. |
| "Run automated checks" | One tap runs scenarios 2, 4, 6a, 6b, 7 and 8, checks each one, and reports a line like `auto platform=ios 2=PASS 4=PASS ...`. |

## Prerequisites

- Bun, Node and Xcode with an iOS simulator runtime.
- Android Studio with an AVD (we use `Pixel_3a_API_35_extension_level_13_arm64-v8a`) and `adb` on the `PATH`
  (`~/Library/Android/sdk/platform-tools`).
- Claude Code **desktop app** for the iOS simulator tool (`mcp__Claude_Code_iOS_Simulator__control`).
  Android needs no special tool; Claude uses `adb` from the shell.

## 1. Start the web page

```bash
bun install
bun run example:web
```

This rebuilds the package (`dist/`) and then serves the page. **Restart it after changing `src/`**,
otherwise the page tests the old build. Leave it running and watch its output for `report` lines.

## 2. iOS simulator

```bash
xcrun simctl boot "iPhone 17 Pro"      # any iPhone; skip if one is booted
open -a Simulator
cd example/app && npm install && npx expo start --ios
```

Expo installs Expo Go on the simulator and opens the app. The simulator shares the Mac's network,
so `localhost:5055` just works.

In Claude Code, the iOS simulator tool does the rest:

| Action | Tool call |
|---|---|
| Show the live panel | `attach` (do it first, before starting Expo) |
| Look | `screenshot` |
| Tap | `tap` with `x`, `y` in device points, taken from the latest screenshot |
| Home (scenario 9) | `button` with `name: "HOME"` |
| Open a URL in Safari (scenario 13) | `xcrun simctl openurl booted http://localhost:5055` |

## 3. Android emulator

```bash
~/Library/Android/sdk/emulator/emulator -list-avds
~/Library/Android/sdk/emulator/emulator -avd Pixel_3a_API_35_extension_level_13_arm64-v8a -no-snapshot-save &
adb wait-for-device
adb reverse tcp:5055 tcp:5055          # makes localhost:5055 inside the emulator reach the Mac
cd example/app && npx expo start --android
```

**`adb reverse` is the step people forget.** Without it the WebView shows a connection error,
because `localhost` inside the emulator is the emulator itself. Run it again after every emulator
restart. Expo sets up the Metro port (8081) on its own.

Claude drives the emulator with plain `adb`:

| Action | Command |
|---|---|
| Look | `adb exec-out screencap -p > "$SCRATCH/android.png"`, then read the PNG |
| Tap | `adb shell input tap X Y` (pixel coordinates from that screenshot) |
| Type | `adb shell input text 'hello'` |
| Home / app switcher / back | `adb shell input keyevent KEYCODE_HOME` / `KEYCODE_APP_SWITCH` / `KEYCODE_BACK` |
| Open a URL in Chrome (scenario 13) | `adb shell am start -a android.intent.action.VIEW -d http://localhost:5055` |
| Reload the app | Press `r` in the `expo start` terminal, or `adb shell input keyevent 82` (dev menu) and tap *Reload* |
| Native logs | `adb logcat -s ReactNativeJS` |

Screenshots are full-resolution pixels; read them, pick coordinates, tap. Take a new screenshot after
every navigation before tapping again.

## 4. Run the scenarios

1. Tap **Run automated checks**. The web server prints one line per platform:

   ```
   report auto platform=ios     2=PASS 4=PASS 6a=PASS 6b=PASS 7=PASS 8=PASS
   report auto platform=android 2=PASS 4=PASS 6a=PASS 6b=PASS 7=PASS 8=PASS
   ```

2. Walk the visual scenarios from the table in [`e2e-results.md`](e2e-results.md): camera
   permission dialog (3), native alert (5), background/foreground (9), external and same-host links
   (10a, 10b, 15), the legacy banner (11), the iframe (12), outside the app (13), `pushState` (17)
   and `inAppHosts` isolation (18).
3. Every page load also reports `report ?badge=...&rnwv=...&isApp=...`. Cold-start the app a few
   times to catch injection races (see the Android badge note in `e2e-results.md`).
4. Update `e2e-results.md` with the date, versions (`xcrun simctl list devices booted`, the Expo SDK,
   the emulator image) and the result of each scenario. For any FAIL, keep the screenshot.

## Adding a scenario

1. Add a handler to `example/app/handlers.ts` if it needs native code.
2. Add a button to `example/web/index.html` and its action to `example/web/src/main.ts`.
   If it needs no native UI, add it to `runAutomatedChecks` so it is checked and reported automatically.
3. Add a row to the table in `e2e-results.md`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Android WebView: "net::ERR_CONNECTION_REFUSED" | `adb reverse tcp:5055 tcp:5055` |
| Page behaves like an old version | Restart `bun run example:web` (it rebuilds `dist/`) and reload the app |
| Metro: "Unable to resolve module" for a nested Expo dependency | Do not add `disableHierarchicalLookup` to `metro.config.js` |
| Metro picks up the root `node_modules` (duplicate React) | Keep the `blockList` entry in `metro.config.js` |
| Chrome on Android asks to accept Google's terms | Accept it yourself; Claude must not accept terms on your behalf |
| Simulator tool: "no booted device" | Boot one with `xcrun simctl boot`, then `attach` again |
