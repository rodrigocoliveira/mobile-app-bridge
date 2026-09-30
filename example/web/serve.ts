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
    // Example files first; /dist/* falls back to the package build (used by second.html and its chunks).
    for (const base of [root, join(root, '../..')]) {
      if (base !== root && !path.startsWith('/dist/')) break
      const file = Bun.file(join(base, path))
      if (await file.exists()) return new Response(file)
    }
    return new Response('Not found', { status: 404 })
  },
})

console.log('example web on http://localhost:5055 (trusted) and http://127.0.0.1:5055 (untrusted)')
