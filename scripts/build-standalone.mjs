// =============================================================
// Cross-platform build helper (Windows/Linux/macOS)
// Thay the lenh `cp -r` (Unix-only) trong script build.
// Chep static assets + public vao .next/standalone cho che do
// `node .next/standalone/server.js` (self-host / sandbox).
// =============================================================

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
const staticDir = join(root, ".next", "static");
const publicDir = join(root, "public");

if (!existsSync(standalone)) {
  console.error("[build-standalone] .next/standalone không tồn tại — hãy chạy `next build` trước (output: 'standalone').");
  process.exit(1);
}

mkdirSync(join(standalone, ".next"), { recursive: true });
cpSync(staticDir, join(standalone, ".next", "static"), { recursive: true });
cpSync(publicDir, join(standalone, "public"), { recursive: true });

console.log("[build-standalone] Copied .next/static and public into .next/standalone/");
