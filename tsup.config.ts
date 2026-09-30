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
