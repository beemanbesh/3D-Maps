#!/usr/bin/env node
/**
 * Performance budget checker for CI/CD pipelines.
 *
 * Budgets:
 * - Total JS bundle: < 2MB (gzipped: ~600KB)
 * - Largest individual chunk: < 800KB
 * - Total CSS: < 100KB
 *
 * Run after `npm run build`:
 *   node scripts/check-bundle-size.js
 */

import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const DIST_DIR = join(process.cwd(), 'dist', 'assets');

const BUDGETS = {
  totalJs: 2 * 1024 * 1024,      // 2MB
  maxChunkJs: 800 * 1024,         // 800KB per chunk
  totalCss: 100 * 1024,           // 100KB
};

function getFiles(dir) {
  try {
    return readdirSync(dir).map((f) => ({
      name: f,
      path: join(dir, f),
      size: statSync(join(dir, f)).size,
      ext: extname(f),
    }));
  } catch {
    console.error(`Build directory not found: ${dir}`);
    console.error('Run "npm run build" first.');
    process.exit(1);
  }
}

const files = getFiles(DIST_DIR);
const jsFiles = files.filter((f) => f.ext === '.js');
const cssFiles = files.filter((f) => f.ext === '.css');

const totalJs = jsFiles.reduce((sum, f) => sum + f.size, 0);
const totalCss = cssFiles.reduce((sum, f) => sum + f.size, 0);
const largestChunk = jsFiles.reduce((max, f) => (f.size > max.size ? f : max), { size: 0, name: '' });

const fmt = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

console.log('\n📦 Bundle Size Report');
console.log('─'.repeat(50));
console.log(`Total JS:       ${fmt(totalJs)} / ${fmt(BUDGETS.totalJs)}`);
console.log(`Largest chunk:  ${fmt(largestChunk.size)} (${largestChunk.name}) / ${fmt(BUDGETS.maxChunkJs)}`);
console.log(`Total CSS:      ${fmt(totalCss)} / ${fmt(BUDGETS.totalCss)}`);
console.log('─'.repeat(50));

jsFiles
  .sort((a, b) => b.size - a.size)
  .slice(0, 5)
  .forEach((f) => console.log(`  ${f.name}: ${fmt(f.size)}`));

let failed = false;
if (totalJs > BUDGETS.totalJs) {
  console.error(`\n❌ OVER BUDGET: Total JS ${fmt(totalJs)} exceeds ${fmt(BUDGETS.totalJs)}`);
  failed = true;
}
if (largestChunk.size > BUDGETS.maxChunkJs) {
  console.error(`\n❌ OVER BUDGET: Chunk ${largestChunk.name} (${fmt(largestChunk.size)}) exceeds ${fmt(BUDGETS.maxChunkJs)}`);
  failed = true;
}
if (totalCss > BUDGETS.totalCss) {
  console.error(`\n❌ OVER BUDGET: Total CSS ${fmt(totalCss)} exceeds ${fmt(BUDGETS.totalCss)}`);
  failed = true;
}

if (failed) {
  process.exit(1);
} else {
  console.log('\n✅ All performance budgets met!');
}
