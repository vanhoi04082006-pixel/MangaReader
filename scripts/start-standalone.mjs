// =============================================================
// Cross-platform standalone server starter.
// Thay the `NODE_ENV=production bun .next/standalone/server.js`
// (cu phap gan bien moi truong Unix-only, khong chay tren Windows).
// =============================================================

process.env.NODE_ENV = "production";

const { spawn } = await import("node:child_process");
const bun = process.execPath; // bun chay script nay -> dung lai bun de chay server
const child = spawn(bun, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: { ...process.env },
});
child.on("exit", (code) => process.exit(code ?? 0));
