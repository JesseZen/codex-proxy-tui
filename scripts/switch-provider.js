#!/usr/bin/env node

/**
 * Switch the running codex-app-proxy to a different provider without restarting.
 *
 * Usage:
 *   npm run switch openai        — hot-swap to .env.openai
 *   npm run switch openrouter    — hot-swap to .env.openrouter
 *   npm run switch:status        — show current provider config
 *   npm run switch:list           — list available .env.<provider> files
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// Read PORT from .env (same file the proxy reads at startup)
// ---------------------------------------------------------------------------
function readPortFromDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  let port = "8787";

  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key === "PORT") {
        port = value;
      }
    }
  } catch {
    // no .env file, use default port
  }

  return port;
}

// ---------------------------------------------------------------------------
// List available providers
// ---------------------------------------------------------------------------
function listProviders() {
  const files = readdirSync(process.cwd());
  const envFiles = files.filter((f) => f.startsWith(".env.") && !f.startsWith(".env.example"));

  if (envFiles.length === 0) {
    console.log("No .env.<provider> files found.");
    return;
  }

  console.log("Available providers:");
  for (const f of envFiles) {
    const name = f.slice(5); // strip ".env."
    let baseUrl = "";
    try {
      const text = readFileSync(path.resolve(process.cwd(), f), "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const eq = trimmed.indexOf("=");
        if (eq === -1) {
          continue;
        }
        const key = trimmed.slice(0, eq).trim();
        if (key === "BASE_URL") {
          let value = trimmed.slice(eq + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          baseUrl = value;
        }
      }
    } catch {
      // ignore
    }
    console.log(`  ${name.padEnd(20)} ${baseUrl || "(no BASE_URL)"}`);
  }
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function fetchStatus(proxyUrl) {
  const res = await fetch(`${proxyUrl}/_proxy/status`);
  const text = await res.text();

  // If the response is HTML, the proxy is running old code without management endpoints
  if (text.trimStart().startsWith("<")) {
    console.error("Proxy does not support management endpoints. Restart with the latest server.js first.");
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Failed to fetch status (HTTP ${res.status}): ${text.slice(0, 200)}`);
    process.exit(1);
  }

  try {
    return JSON.parse(text);
  } catch {
    console.error(`Unexpected response from proxy. Is the proxy running on port ${proxyUrl.replace(/.*:/, "")}?`);
    process.exit(1);
  }
}

async function switchProvider(proxyUrl, providerName) {
  const res = await fetch(`${proxyUrl}/_proxy/switch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: providerName }),
  });

  const text = await res.text();

  // If the response is HTML, the proxy is running old code without management endpoints
  if (text.trimStart().startsWith("<")) {
    console.error("Proxy does not support management endpoints. Restart with the latest server.js first.");
    process.exit(1);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`Unexpected response from proxy (HTTP ${res.status}): ${text.slice(0, 200)}`);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Switch failed (HTTP ${res.status}): ${body.error?.message || JSON.stringify(body)}`);
    process.exit(1);
  }

  return body;
}

function printProvider(label, config) {
  const p = config.activeProvider || "(none)";
  const b = config.baseUrl || "";
  const f = config.apiFormat || "(passthrough)";
  const m = config.modelNameOverride || "(default)";
  console.log(`  ${label}:`);
  console.log(`    provider:  ${p}`);
  console.log(`    baseUrl:   ${b}`);
  console.log(`    apiFormat: ${f}`);
  console.log(`    model:     ${m}`);
  console.log(`    apiKey:    ${config.hasApiKey ? "set" : "not set"}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const port = readPortFromDotEnv();
const proxyUrl = `http://127.0.0.1:${port}`;
const arg = process.argv[2] || "";

if (arg === "--status") {
  const status = await fetchStatus(proxyUrl);
  printProvider("Current", status);
  process.exit(0);
}

if (arg === "--list") {
  listProviders();
  process.exit(0);
}

if (!arg) {
  console.log("Usage:");
  console.log("  npm run switch <provider>     — hot-swap to a different provider");
  console.log("  npm run switch:status          — show current provider config");
  console.log("  npm run switch:list            — list available providers");
  console.log("");
  listProviders();
  process.exit(1);
}

// Verify .env.<provider> exists before attempting switch
const envFile = path.resolve(process.cwd(), `.env.${arg}`);
try {
  readFileSync(envFile, "utf8");
} catch {
  console.error(`Error: .env.${arg} not found`);
  process.exit(1);
}

// Show current
console.log("Before:");
const before = await fetchStatus(proxyUrl);
printProvider("current", before);

// Switch
console.log(`\nSwitching to: ${arg} ...`);
const result = await switchProvider(proxyUrl, arg);
console.log("✓ Switched successfully\n");
printProvider("now", result.current);
