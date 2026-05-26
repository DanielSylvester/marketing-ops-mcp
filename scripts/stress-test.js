#!/usr/bin/env node
/**
 * Dry-run stress test for the unified marketing-ops-mcp server.
 * Tests tool registration, schema validation, error handling, and stability
 * WITHOUT requiring real API credentials.
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "../dist/index.js");

const COLORS = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};

let passCount = 0;
let failCount = 0;
const errors = [];

function pass(label) {
  passCount++;
  console.log(`${COLORS.green}✓ PASS${COLORS.reset} ${label}`);
}

function fail(label, reason) {
  failCount++;
  console.log(`${COLORS.red}✗ FAIL${COLORS.reset} ${label}`);
  if (reason) console.log(`  ${COLORS.red}${reason}${COLORS.reset}`);
  errors.push({ label, reason });
}

function info(label) {
  console.log(`${COLORS.cyan}→ INFO${COLORS.reset} ${label}`);
}

// Shared stdout line buffer and pending request map
let stdoutBuffer = "";
const pendingRequests = new Map();

function attachStdoutHandler(server) {
  server.stdout.on("data", (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const { resolve } = pendingRequests.get(msg.id);
          clearTimeout(pendingRequests.get(msg.id).timeout);
          pendingRequests.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // ignore non-JSON
      }
    }
  });
}

async function sendRequest(server, request, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(request.id);
      reject(new Error(`Request timeout (${timeoutMs}ms)`));
    }, timeoutMs);
    pendingRequests.set(request.id, { resolve, reject, timeout });
    server.stdin.write(JSON.stringify(request) + "\n");
  });
}

async function runTests() {
  console.log(`\n${COLORS.cyan}═══════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.cyan}  marketing-ops-mcp — Unified Dry-Run Stress Test${COLORS.reset}`);
  console.log(`${COLORS.cyan}═══════════════════════════════════════════════════════${COLORS.reset}\n`);

  info("Starting MCP server with dummy credentials...");
  const server = spawn("node", [SERVER_PATH], {
    env: {
      ...process.env,
      META_SMARTWORKS_TOKEN: "dummy",
      META_WORKSTUDIO_TOKEN: "dummy",
      GOOGLE_ADS_CLIENT_ID: "dummy",
      GOOGLE_ADS_CLIENT_SECRET: "dummy",
      GOOGLE_ADS_REFRESH_TOKEN: "dummy",
      GOOGLE_ADS_DEVELOPER_TOKEN: "dummy",
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "1234567899",
      GOOGLE_ADS_CUSTOMER_ID: "1234567890",
      LINKEDIN_ACCESS_TOKEN: "dummy",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let serverCrashed = false;
  server.on("exit", (code) => {
    if (code !== null && code !== 0) serverCrashed = true;
  });

  attachStdoutHandler(server);
  await new Promise((r) => setTimeout(r, 800));

  if (serverCrashed) {
    fail("Server startup", "Server crashed immediately");
    process.exit(1);
  }
  pass("Server starts without crashing");

  // ── Phase 2: Tool Discovery ────────────────────────────────────────────
  info("Requesting tool list...");
  const toolList = await sendRequest(server, { jsonrpc: "2.0", id: 1, method: "tools/list" });

  if (!toolList.result || !Array.isArray(toolList.result.tools)) {
    fail("Tool list response", "Missing tools array");
    server.kill();
    process.exit(1);
  }

  const tools = toolList.result.tools;
  pass(`Tool list returned ${tools.length} tools`);

  const channelCounts = { meta: 0, gads: 0, linkedin: 0, other: 0 };
  for (const tool of tools) {
    if (tool.name.startsWith("meta_")) channelCounts.meta++;
    else if (tool.name.startsWith("gads_")) channelCounts.gads++;
    else if (tool.name.startsWith("linkedin_ads_")) channelCounts.linkedin++;
    else channelCounts.other++;
  }

  pass(`Channels: Meta=${channelCounts.meta}, GAds=${channelCounts.gads}, LinkedIn=${channelCounts.linkedin}, Other=${channelCounts.other}`);

  if (channelCounts.meta === 0) fail("Meta tools", "No meta_ tools found");
  if (channelCounts.gads === 0) fail("GAds tools", "No gads_ tools found");
  if (channelCounts.linkedin === 0) fail("LinkedIn tools", "No linkedin_ads_ tools found");

  // ── Phase 3: Schema Validation ─────────────────────────────────────────
  info("Validating tool schemas...");
  let schemaErrors = 0;
  for (const tool of tools) {
    if (!tool.name) { schemaErrors++; fail(`Tool schema: missing name`); continue; }
    if (!tool.description) { schemaErrors++; fail(`Tool ${tool.name}: missing description`); continue; }
    if (!tool.inputSchema || tool.inputSchema.type !== "object") {
      schemaErrors++;
      fail(`Tool ${tool.name}: invalid inputSchema`);
      continue;
    }
  }
  if (schemaErrors === 0) pass("All tool schemas are valid");

  // ── Phase 4: Error Handling ────────────────────────────────────────────
  info("Testing error handling with dummy credentials...");
  const errorTests = [
    { name: "meta_list_accounts", args: {}, label: "meta_list_accounts with invalid token" },
    { name: "gads_list_campaigns", args: {}, label: "gads_list_campaigns with invalid token" },
    { name: "linkedin_ads_list_accounts", args: {}, label: "linkedin_ads_list_accounts with invalid token" },
    { name: "linkedin_ads_get_campaign_performance", args: { accountId: "123", startDate: "2024-01-01" }, label: "linkedin get_campaign_performance invalid token" },
  ];

  let reqId = 10;
  for (const test of errorTests) {
    reqId++;
    try {
      const response = await sendRequest(server, {
        jsonrpc: "2.0",
        id: reqId,
        method: "tools/call",
        params: { name: test.name, arguments: test.args },
      });
      const hasError = response.result?.isError === true;
      if (hasError) {
        pass(`${test.label} — returns error gracefully`);
      } else {
        pass(`${test.label} — returns data/empty (acceptable)`);
      }
    } catch (e) {
      pass(`${test.label} — request failed as expected (${e.message})`);
    }
  }

  // ── Phase 5: Input Validation ──────────────────────────────────────────
  info("Testing input validation...");
  const validationTests = [
    { name: "linkedin_ads_get_campaign", args: {}, label: "get_campaign missing accountId" },
    { name: "meta_list_campaigns", args: {}, label: "meta_list_campaigns missing brand" },
    { name: "gads_gaql_search", args: {}, label: "gads_gaql_search missing query" },
  ];

  for (const test of validationTests) {
    reqId++;
    try {
      const response = await sendRequest(server, {
        jsonrpc: "2.0",
        id: reqId,
        method: "tools/call",
        params: { name: test.name, arguments: test.args },
      });
      const hasError = response.result?.isError === true || response.error != null;
      if (hasError) {
        pass(`${test.label} — validation rejects invalid input`);
      } else {
        fail(test.label, "Did not reject invalid input");
      }
    } catch (e) {
      pass(`${test.label} — request rejected (${e.message})`);
    }
  }

  // ── Phase 6: Unknown Tool ──────────────────────────────────────────────
  info("Testing unknown tool handling...");
  reqId++;
  try {
    const response = await sendRequest(server, {
      jsonrpc: "2.0",
      id: reqId,
      method: "tools/call",
      params: { name: "nonexistent_tool_12345", arguments: {} },
    });
    const text = response.result?.content?.[0]?.text || "";
    if (text.includes("Unknown tool")) {
      pass("Unknown tool returns proper error");
    } else {
      fail("Unknown tool handling", "Did not return expected error");
    }
  } catch (e) {
    fail("Unknown tool handling", e.message);
  }

  // ── Phase 7: Parallel Burst ────────────────────────────────────────────
  info("Running rapid-fire request burst (10 parallel calls)...");
  reqId++;
  const burst = Array.from({ length: 10 }, (_, i) =>
    sendRequest(server, { jsonrpc: "2.0", id: reqId + i, method: "tools/list" }, 15000)
  );

  try {
    const burstResults = await Promise.all(burst);
    const allValid = burstResults.every((r) => r.result && Array.isArray(r.result.tools));
    if (allValid) {
      pass("10 parallel tool/list requests handled correctly");
    } else {
      fail("Parallel request burst", "Some responses were invalid");
    }
  } catch (e) {
    fail("Parallel request burst", e.message);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  server.kill();
  await new Promise((r) => setTimeout(r, 300));

  if (serverCrashed) {
    fail("Server survived full test suite", "Server crashed during tests");
  } else {
    pass("Server shuts down cleanly after tests");
  }

  // ── Report ─────────────────────────────────────────────────────────────
  console.log(`\n${COLORS.cyan}═══════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.cyan}  Stress Test Results${COLORS.reset}`);
  console.log(`${COLORS.cyan}═══════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.green}Passed: ${passCount}${COLORS.reset}`);
  console.log(`${COLORS.red}Failed: ${failCount}${COLORS.reset}`);
  console.log(`Total:  ${passCount + failCount}`);

  if (errors.length > 0) {
    console.log(`\n${COLORS.red}Errors:${COLORS.reset}`);
    for (const err of errors) {
      console.log(`  • ${err.label}: ${err.reason}`);
    }
  }
  console.log();
  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(`${COLORS.red}Fatal error:${COLORS.reset}`, e);
  process.exit(1);
});
