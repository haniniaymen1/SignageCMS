/**
 * Copie cross-platform (Windows/Linux/macOS) des assets statiques dans le build standalone Next.js.
 * Remplace `cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/` (Linux-only).
 * Usage : node scripts/copy-standalone.js   (après `next build`)
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[copy-standalone] introuvable : ${src}`)
    process.exit(1)
  }
  fs.cpSync(src, dest, { recursive: true, force: true })
  console.log(`[copy-standalone] ${src} -> ${dest}`)
}

const root = process.cwd()
copyRecursive(
  path.join(root, '.next', 'static'),
  path.join(root, '.next', 'standalone', '.next', 'static'),
)
copyRecursive(
  path.join(root, 'public'),
  path.join(root, '.next', 'standalone', 'public'),
)
console.log('[copy-standalone] Build standalone prêt : .next/standalone/server.js')
