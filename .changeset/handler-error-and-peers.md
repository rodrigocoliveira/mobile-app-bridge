---
"@rodrigocoliveira/mobile-app-bridge": patch
---

A handler that throws a prototype-less object (`Object.create(null)`) now answers `HANDLER_ERROR` instead of leaving the page waiting until `TIMEOUT`. The `react-native` peer range now starts at 0.79 (Expo SDK 53), the first version whose Metro resolves the package's `exports` subpaths by default.
