import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { once } from "node:events"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const magpieSource = process.env.MAGPIE_TEST_EXE
const pigExe = process.env.PIG_TEST_EXE
assert.ok(magpieSource && pigExe, "Set MAGPIE_TEST_EXE and PIG_TEST_EXE to native executables")
await mkdir(join(root, ".sandbox"), { recursive: true })
const sandbox = await mkdtemp(join(root, ".sandbox", "run-"))
const home = join(sandbox, "home")
const config = join(home, ".config")
const pigDir = join(home, ".pig", "agent")
const toolsDir = join(sandbox, "bin")
await mkdir(toolsDir, { recursive: true })
await mkdir(pigDir, { recursive: true })
const magpieExe = join(toolsDir, process.platform === "win32" ? "magpie.exe" : "magpie")
await copyFile(magpieSource, magpieExe)

const env = {}
for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SYSTEMDRIVE"]) {
  if (process.env[name]) env[name] = process.env[name]
}
Object.assign(env, {
  HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"),
  LOCALAPPDATA: join(home, "AppData", "Local"), XDG_CONFIG_HOME: config,
  XDG_CACHE_HOME: join(home, ".cache"), TEMP: sandbox, TMP: sandbox,
  PIG_HOME: join(home, ".pig"), MAGPIE_NO_ACCOUNTS: "1", MAGPIE_PLUGIN_MARKET: "off",
  DO_NOT_TRACK: "1", PI_TELEMETRY: "0", PI_OFFLINE: "1", NO_PROXY: "127.0.0.1,localhost",
})

const realFiles = [".config/magpie/settings.json", ".config/magpie/plugins.json", ".config/magpie/stash.json",
  ".pig/agent/models.json", ".pig/agent/settings.json", ".pig/agent/auth.json"]
const fingerprints = async () => Promise.all(realFiles.map(async (name) => {
  try { return createHash("sha256").update(await readFile(join(process.env.USERPROFILE, name))).digest("hex") }
  catch (error) { if (error.code === "ENOENT") return null; throw error }
}))
const before = await fingerprints()
const logs = []
async function run(exe, args) {
  const child = spawn(exe, args, { env, cwd: sandbox, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = "", stderr = ""
  child.stdout.on("data", (part) => { stdout += part })
  child.stderr.on("data", (part) => { stderr += part })
  const timer = setTimeout(() => child.kill(), 45000)
  try {
    const [code] = await once(child, "exit")
    logs.push({ args, code, stdout, stderr })
    assert.equal(code, 0, `${args.join(" ")}\n${stdout}\n${stderr}`)
    return stdout
  } finally { clearTimeout(timer) }
}
const m = (...args) => run(magpieExe, args)
const readJSON = async (path) => JSON.parse(await readFile(path, "utf8"))
const modelsPath = join(pigDir, "models.json")
const settingsPath = join(pigDir, "settings.json")
const seed = { note: "keep", providers: {
  local: { baseUrl: "http://127.0.0.1:1/v1", api: "openai-responses", apiKey: "local-test", models: [{ id: "original" }] },
  magpie: { name: "Original", baseUrl: "http://127.0.0.1:2/v1", api: "openai-completions", apiKey: "original-test", models: [{ id: "before" }], custom: "keep" },
} }
const settings = { theme: "dark", defaultProvider: "local", defaultModel: "original" }
await writeFile(modelsPath, JSON.stringify(seed, null, 2))
await writeFile(settingsPath, JSON.stringify(settings, null, 2))
await writeFile(join(sandbox, "proof.txt"), "PIG_TOOL_PROOF_731\n")

const requests = []
const upstream = createServer(async (req, res) => {
  try {
    if (req.method === "GET") {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ data: ["test-coder", "test-fast"].map((id) => ({
        id, object: "model", context_window: 64000, max_output_tokens: 4000,
        reasoning: true, reasoning_levels: ["low", "high"], modalities: { input: ["text", "image"] },
      })) }))
      return
    }
    let text = ""
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    requests.push(body)
    assert.ok(requests.length < 8, "unexpected model request loop")
    const toolResult = (body.input ?? []).find((item) => item.type === "function_call_output")
    const output = toolResult
      ? [{ type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{ type: "output_text", text: "PIG_TOOL_PROOF_731", annotations: [] }] }]
      : [{ type: "function_call", id: "fc_test", call_id: "call_read_proof", name: "read", arguments: JSON.stringify({ path: join(sandbox, "proof.txt") }), status: "completed" }]
    const response = { id: "resp_test", object: "response", created_at: 1, status: "completed", model: body.model,
      output, usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 0 } } }
    if (!body.stream) {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify(response))
      return
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" })
    const send = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`)
    send("response.created", { response: { ...response, status: "in_progress", output: [] } })
    const item = output[0]
    send("response.output_item.added", { output_index: 0, item: item.type === "function_call" ? { ...item, arguments: "" } : { ...item, content: [] } })
    if (item.type === "function_call") {
      send("response.function_call_arguments.delta", { item_id: item.id, output_index: 0, delta: item.arguments })
      send("response.function_call_arguments.done", { item_id: item.id, output_index: 0, arguments: item.arguments })
    } else {
      send("response.content_part.added", { item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } })
      send("response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text })
      send("response.output_text.done", { item_id: item.id, output_index: 0, content_index: 0, text: item.content[0].text })
    }
    send("response.output_item.done", { output_index: 0, item })
    send("response.completed", { response })
    res.end()
  } catch (error) { res.writeHead(500); res.end(String(error)) }
})
upstream.listen(0, "127.0.0.1")
await once(upstream, "listening")
const upstreamURL = `http://127.0.0.1:${upstream.address().port}/v1`
const portProbe = createServer()
portProbe.listen(0, "127.0.0.1")
await once(portProbe, "listening")
const gatewayPort = portProbe.address().port
await new Promise((resolve) => portProbe.close(resolve))
env.MAGPIE_ADDR = `127.0.0.1:${gatewayPort}`
let gatewayProcess
const checks = []
try {
  await m("plugin", "add", root)
  assert.ok((await readJSON(join(config, "magpie", "plugins.json"))).plugins.some((entry) => entry.spec === root))
  assert.match(await m("agents"), /PiG/)
  checks.push("isolated plugin registration and real moejs Agent discovery")
  await m("provider", "add", "PiG test", "id=pig-test", `responses=${upstreamURL}`, "key=fixture-key", "models=test-coder,test-fast", "context=64000")
  await m("model", "efforts", "pig-test/test-coder", "none,low,high,xhigh")
  await m("pig", "provider", "magpie")
  let wired = await readJSON(modelsPath)
  assert.deepEqual(wired.providers.local, seed.providers.local)
  assert.equal(wired.providers.magpie.custom, "keep")
  assert.equal(wired.providers.magpie.name, "Magpie")
  assert.equal(wired.providers.magpie.baseUrl, `http://127.0.0.1:${gatewayPort}/v1`)
  assert.ok(wired.providers.magpie.apiKey.includes("pig"))
  assert.ok(wired.providers.magpie.models.some((model) => model.id === "pig-test/test-coder"))
  const coder = wired.providers.magpie.models.find((model) => model.id === "pig-test/test-coder")
  assert.equal(coder.reasoning, true)
  assert.equal(coder.thinkingLevelMap.off, "none")
  assert.equal(coder.thinkingLevelMap.xhigh, "xhigh")
  assert.deepEqual(await readJSON(settingsPath), settings)
  checks.push("connect writes Magpie provider without changing other providers or PiG defaults")
  const list = await run(pigExe, ["--no-extensions", "--no-mcp", "--list-models"])
  assert.match(list, /magpie/)
  assert.match(list, /pig-test\/test-coder/)
  checks.push("PiG 0.5.0 loads generated provider and models")

  await m("provider", "models", "pig-test", "test-coder")
  wired = await readJSON(modelsPath)
  assert.ok(!wired.providers.magpie.models.some((model) => model.id === "pig-test/test-fast"))
  await m("group", "add", "PiG daily", "models=pig-test/test-coder", "routing=order")
  assert.ok((await readJSON(modelsPath)).providers.magpie.models.some((model) => model.id.startsWith("group/")))
  checks.push("model removals and routing groups sync into PiG catalog")
  await m("visible", "pig", "pig-test")
  assert.ok((await readJSON(modelsPath)).providers.magpie.models.every((model) => model.id.startsWith("pig-test/")))
  await m("visible", "pig", "all")
  assert.ok((await readJSON(modelsPath)).providers.magpie.models.some((model) => model.id.startsWith("group/")))
  checks.push("Magpie per-Agent visibility filters control PiG's model list")

  gatewayProcess = spawn(magpieExe, ["serve"], { env, cwd: sandbox, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] })
  let gatewayLog = ""
  gatewayProcess.stderr.on("data", (part) => { gatewayLog += part })
  const deadline = Date.now() + 15000
  let ready = false
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/hello`); ready = response.ok; if (ready) break } catch {}
    if (gatewayProcess.exitCode !== null) throw new Error(gatewayLog)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, `isolated gateway did not start: ${gatewayLog}`)
  const reply = await run(pigExe, ["--no-extensions", "--no-mcp", "--no-skills", "--no-context-files", "--no-session",
    "--tools", "read", "--model", "magpie/pig-test/test-coder", "-p", "Read proof.txt and return its contents."])
  assert.match(reply, /PIG_TOOL_PROOF_731/)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].model, "test-coder")
  assert.ok(requests[1].input.some((item) => item.type === "function_call_output" && JSON.stringify(item.output).includes("PIG_TOOL_PROOF_731")))
  checks.push("PiG → real Magpie gateway → mock Responses stream → read tool → final response")
  const usage = (await readFile(join(config, "magpie", "usage.jsonl"), "utf8")).trim().split("\n").map(JSON.parse)
  assert.ok(usage.some((row) => row.agent === "pig"), "gateway usage should name PiG")
  checks.push("gateway usage attributes model requests to pig")
  await m("pig", "provider", "default")
  assert.deepEqual(await readJSON(modelsPath), seed)
  assert.deepEqual(await readJSON(settingsPath), settings)
  checks.push("disconnect restores original provider values and leaves PiG defaults intact")
  await writeFile(modelsPath, JSON.stringify({ providers: { local: seed.providers.local } }))
  await m("pig", "provider", "magpie")
  await m("pig", "provider", "default")
  const disconnected = await readJSON(modelsPath)
  assert.deepEqual(disconnected.providers.local, seed.providers.local)
  assert.equal(Object.keys(disconnected.providers.magpie ?? {}).length, 0)
  assert.doesNotMatch(await run(pigExe, ["--no-extensions", "--no-mcp", "--list-models"]), /pig-test\/test-coder/)
  checks.push("disconnect removes newly introduced gateway keys and PiG still loads its catalog")
} finally {
  if (gatewayProcess && gatewayProcess.exitCode === null) {
    const stopped = once(gatewayProcess, "exit")
    gatewayProcess.kill()
    await stopped
  }
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
  const after = await fingerprints()
  assert.deepEqual(after, before, "real Magpie/PiG config fingerprints changed")
  await writeFile(join(sandbox, "commands.json"), JSON.stringify(logs, null, 2))
  await writeFile(join(sandbox, "result.json"), JSON.stringify({ checks, requests: requests.length, realConfigUnchanged: true }, null, 2))
  console.log(JSON.stringify({ sandbox, checks, requests: requests.length, realConfigUnchanged: true }, null, 2))
}
