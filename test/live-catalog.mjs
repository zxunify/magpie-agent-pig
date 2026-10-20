import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { once } from "node:events"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { connect } from "../pig.agent.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const exe = process.env.PIG_TEST_EXE
assert.ok(exe, "Set PIG_TEST_EXE to the native PiG executable")
const gatewayURL = process.env.MAGPIE_TEST_URL ?? "http://127.0.0.1:3425"
assert.match(gatewayURL, /^http:\/\/127\.0\.0\.1:\d+$/)
const key = "magpie-pig"
const response = await fetch(`${gatewayURL}/v1/models`, {
  headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
})
assert.ok(response.ok, `model list HTTP ${response.status}`)
const { data } = await response.json()
assert.ok(Array.isArray(data) && data.length, "expected current Magpie models")
const values = connect({ gateway: { v1: `${gatewayURL}/v1`, key }, models: data.map((model) => ({
  id: model.id, name: model.display_name ?? model.id, context: model.context_window,
  output: model.max_output_tokens, images: model.modalities?.input?.includes("image") === true,
  efforts: model.reasoning_levels ?? [],
})) })
const provider = Object.fromEntries(Object.entries(values).map(([path, value]) => [path.slice("providers.magpie.".length), value]))
await mkdir(join(root, ".sandbox"), { recursive: true })
const sandbox = await mkdtemp(join(root, ".sandbox", "live-catalog-"))
const pigDir = join(sandbox, "pig", "agent")
await mkdir(pigDir, { recursive: true })
await writeFile(join(pigDir, "models.json"), JSON.stringify({ providers: { magpie: provider } }, null, 2))
const env = { ...process.env, PIG_HOME: join(sandbox, "pig"), PIG_CODING_AGENT_DIR: pigDir,
  PIG_USE_PI_DIRS: "0", PI_OFFLINE: "1", PI_TELEMETRY: "0" }
const child = spawn(exe, ["--no-extensions", "--no-mcp", "--list-models"], {
  env, cwd: sandbox, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
})
let stdout = "", stderr = ""
child.stdout.on("data", (part) => { stdout += part })
child.stderr.on("data", (part) => { stderr += part })
const timer = setTimeout(() => child.kill(), 20000)
try {
  const [code] = await once(child, "exit")
  assert.equal(code, 0, stderr)
  for (const model of data) assert.ok(stdout.includes(model.id), `PiG did not list ${model.id}`)
  const result = { models: data.length, allListedByPiG: true, generationRequests: 0, sandbox }
  await writeFile(join(sandbox, "result.json"), JSON.stringify(result, null, 2))
  await writeFile(join(sandbox, "pig-models.txt"), stdout)
  console.log(JSON.stringify(result, null, 2))
} finally { clearTimeout(timer) }
