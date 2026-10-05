# @rodrigocoliveira/mobile-app-bridge

## 0.1.1

### Patch Changes

- b57dabb: A handler that throws a prototype-less object (`Object.create(null)`) now answers `HANDLER_ERROR` instead of leaving the page waiting until `TIMEOUT`. The `react-native` peer range now starts at 0.79 (Expo SDK 53), the first version whose Metro resolves the package's `exports` subpaths by default.

## 0.1.0

### Minor Changes

- 9d4a28c: Initial release: promise-based `bridge.call` / `bridge.on` for the web page, and `BridgeWebView` / `useBridgeEmitter` for the Expo app.
