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
    // v3.11.21 — public/ est optionnel : l'archive serveur (Linux/Windows) a
    // longtemps été extraite sans ce dossier, ce qui faisait échouer le build
    // APRÈS une compilation pourtant réussie (« Build impossible » trompeur).
    // On le recrée vide au lieu d'abandonner. .next/static absent reste une
    // erreur fatale : sans lui le serveur n'a pas ses assets.
    if (path.basename(src) === 'public') {
      console.warn(`[copy-standalone] ${src} absent : créé (répertoire vide)`)
      fs.mkdirSync(src, { recursive: true })
    } else {
      console.error(`[copy-standalone] introuvable : ${src}`)
      process.exit(1)
    }
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
