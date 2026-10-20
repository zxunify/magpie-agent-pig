import assert from "node:assert/strict"
import test from "node:test"
import { agent, connect } from "./pig.agent.js"

const gateway = { v1: "http://127.0.0.1:3499/v1", key: "magpie-pig-test" }

test("connect-only Agent targets PiG's model catalog", () => {
  assert.equal(agent.id, "pig")
  assert.equal(agent.bin, "pig")
  assert.equal(agent.config, "~/.pig/agent/models.json")
  assert.equal(agent.model, undefined)
})

test("preserves qualified model/group IDs, limits, vision and exact reasoning levels", () => {
  const result = connect({ gateway, models: [
    { id: "codex/model.with/slashes", name: "Coder", context: 512000, output: 128000, images: true, efforts: ["low", "high", "xhigh", "ultra"] },
    { id: "group/daily", name: "Daily", context: 64000, output: 4000, images: false, efforts: [] },
  ] })
  assert.equal(result["providers.magpie.api"], "openai-responses")
  assert.equal(result["providers.magpie.apiKey"], gateway.key)
  assert.equal(result["providers.magpie.baseUrl"], gateway.v1)
  assert.ok(Object.keys(result).every((key) => key.startsWith("providers.magpie.")))
  const [coder, group] = result["providers.magpie.models"]
  assert.deepEqual(coder, {
    id: "codex/model.with/slashes", name: "Coder", reasoning: true,
    input: ["text", "image"], contextWindow: 512000, maxTokens: 128000,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: "xhigh", max: null },
  })
  assert.equal(group.id, "group/daily")
  assert.equal(group.reasoning, false)
  assert.equal(group.thinkingLevelMap, undefined)
  assert.deepEqual(group.input, ["text"])
})

test("unknown limits use Pi/PiG defaults, and off maps to the gateway's none", () => {
  const models = connect({ gateway, models: [
    { id: "unknown" }, { id: "small", context: 2048, output: 8000 },
    { id: "invalid", context: -1, output: NaN, efforts: ["ultra"] },
    { id: "reasoning", efforts: ["none", "low", "max"] },
  ] })["providers.magpie.models"]
  assert.equal(models[0].name, "unknown")
  assert.equal(models[0].contextWindow, undefined)
  assert.equal(models[0].maxTokens, undefined)
  assert.equal(models[1].maxTokens, 2048)
  assert.equal(models[2].contextWindow, undefined)
  assert.equal(models[2].reasoning, false)
  assert.equal(models[3].thinkingLevelMap.off, "none")
  assert.equal(models[3].thinkingLevelMap.max, "max")
})

test("empty catalogs remove stale entries; malformed inputs fail before writing", () => {
  assert.deepEqual(connect({ gateway, models: [] })["providers.magpie.models"], [])
  for (const models of [[{}], [null], [{ id: " " }], [{ id: "a" }, { id: "a" }]]) {
    assert.throws(() => connect({ gateway, models }), /model IDs/)
  }
  for (const input of [{}, { gateway, models: null }, { gateway: { ...gateway, key: "" }, models: [] },
    { gateway: { ...gateway, v1: "file:///config" }, models: [] }]) {
    assert.throws(() => connect(input), /gateway URL/)
  }
})
