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
