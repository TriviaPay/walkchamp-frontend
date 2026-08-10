/**
 * Controlled migration: wrap remaining literal fontSize: N with rf(N).
 *
 * Safe on the design baseline (390×844): rf(n) === n.
 * Does NOT remap sizes to semantic tokens (preserves intentional per-screen differences).
 * Skips type annotations and already-wrapped rf()/responsiveFont() calls.
 *
 * Usage: node scripts/migrate-fontsize-rf.js [--dry-run]
 */
const fs = require("fs");
const path = require("path");

const DRY = process.argv.includes("--dry-run");
const ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", "Backend", "android", "ios", ".git", "dist", "build"]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, acc);
    } else if (/\.(tsx|ts)$/.test(e.name) && !e.name.endsWith(".test.ts") && !e.name.endsWith(".test.tsx")) {
      acc.push(p);
    }
  }
  return acc;
}

function ensureRfImport(src) {
  if (/from\s+["']@\/utils\/responsive["']/.test(src)) {
    // Already imports from responsive — ensure rf is named
    return src.replace(
      /import\s*\{([^}]*)\}\s*from\s*["']@\/utils\/responsive["']/,
      (full, names) => {
        if (/\brf\b/.test(names)) return full;
        const trimmed = names.trim().replace(/,$/, "");
        return `import { ${trimmed ? trimmed + ", " : ""}rf } from "@/utils/responsive"`;
      },
    );
  }
  // Insert after the last import
  const importBlock = /^((?:import[\s\S]*?;\r?\n)+)/m;
  const m = src.match(importBlock);
  const line = `import { rf } from "@/utils/responsive";\n`;
  if (m) {
    return src.replace(importBlock, m[1] + line);
  }
  return line + src;
}

let filesChanged = 0;
let replacements = 0;

for (const root of ROOTS) {
  const files = walk(root);
  for (const file of files) {
    let src = fs.readFileSync(file, "utf8");
    let count = 0;
    const next = src.replace(/fontSize:\s*(\d+(?:\.\d+)?)\b/g, (match, num, offset) => {
      // Skip if already rf( or responsiveFont(
      const before = src.slice(Math.max(0, offset - 24), offset);
      if (/rf\s*\(\s*$/.test(before) || /responsiveFont(?:Size)?\s*\(\s*$/.test(before)) {
        return match;
      }
      // Skip TypeScript type fields like `fontSize: number`
      if (num === "number" || /fontSize:\s*number/.test(match)) return match;
      count += 1;
      return `fontSize: rf(${num})`;
    });

    if (count === 0) continue;

    let out = ensureRfImport(next);
    // Deduplicate accidental double rf import lines
    out = out.replace(
      /(import\s*\{[^}]*\brf\b[^}]*\}\s*from\s*["']@\/utils\/responsive["'];\r?\n)(?:import\s*\{[^}]*\brf\b[^}]*\}\s*from\s*["']@\/utils\/responsive["'];\r?\n)+/g,
      "$1",
    );

    filesChanged += 1;
    replacements += count;
    console.log(`${file}: ${count}`);
    if (!DRY) fs.writeFileSync(file, out, "utf8");
  }
}

console.log(`\n${DRY ? "[dry-run] " : ""}files=${filesChanged} replacements=${replacements}`);
