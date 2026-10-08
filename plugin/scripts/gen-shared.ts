// Writes plugin/source/core/generated/shared.json: the data the native plugin
// shares with the browser app (circuit timing, General MIDI percussion notes,
// engine and pattern constants). The browser source is the authority; the C++
// tests compare their constants against this file, and tests/plugin-shared.test.ts
// fails when this file is stale.
//   npx tsx plugin/scripts/gen-shared.ts [--check]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharedData } from './shared-data.ts'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../source/core/generated/shared.json')
const text = JSON.stringify(sharedData(), null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text) {
    console.error(`${out} is stale. Run: npx tsx plugin/scripts/gen-shared.ts`)
    process.exit(1)
  }
  console.log('shared.json is current')
} else {
  writeFileSync(out, text)
  console.log(`wrote ${out}`)
}
