// Minimal, reproducible integration hook. The upstream checkout remains unchanged.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const upstream = fileURLToPath(new URL('../../opensource/hermes-copywriting-engine/server.js', import.meta.url));
let source = await readFile(upstream, 'utf8');
const replacements = [
  ['const DATA_DIR = path.join(__dirname, "data");', 'const DATA_DIR = process.env.HERMES_DATA_DIR || path.join(__dirname, "data");'],
  ['async function callHermesClean(prompt) {', 'async function callHermesClean(prompt, options = {}) {'],
  ['for (const targetEndpoint of fallbackEndpoints)', 'for (const targetEndpoint of (options.singleAttempt ? [endpoint] : fallbackEndpoints))'],
  ['hermesConfigured: Boolean(process.env.HERMES_API_URL),', 'hermesConfigured: Boolean(process.env.HERMES_API_URL), studioBridge: true, model: process.env.HERMES_MODEL || null,'],
  ['server.listen(PORT,', 'server.listen(PORT, "127.0.0.1",'],
];
for(const [before,after] of replacements){if(!source.includes(before))throw new Error(`hermes_upstream_contract_changed: ${before}`);source=source.replace(before,after);}
const anchor='if (req.method === "GET" && url.pathname === "/api/config") {';
if(!source.includes(anchor))throw new Error('hermes_upstream_router_changed');
source=source.replace(anchor, `if (req.method === "POST" && url.pathname === "/api/studio-copywriting") {
      const input = await readJson(req);
      if (!process.env.HERMES_API_URL) return sendJson(res, {error:"hermes_not_configured"}, 409);
      if (typeof input.system !== "string" || typeof input.user !== "string") return sendJson(res, {error:"studio_context_required"}, 400);
      const result = await callHermes(input.system + "\\n\\n" + input.user, {singleAttempt:true});
      if (result.mode === "draft") return sendJson(res, {error:"hermes_draft_fallback_denied"}, 409);
      return sendJson(res, {text:result.text, mode:result.mode, model:process.env.HERMES_MODEL || null});
    }
    ${anchor}`);
const runtime = upstream.replace(/server\.js$/, '.studio-runtime-server.mjs');
await writeFile(runtime, source, 'utf8');
await import(pathToFileURL(runtime).href);
