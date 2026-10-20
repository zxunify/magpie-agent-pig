export const agent = {
  id: "pig",
  name: "PiG",
  bin: "pig",
  dir: "~/.pig/agent",
  config: "~/.pig/agent/models.json",
  ua: ["pig"],
  notice: "Restart PiG, then use /model to select a Magpie model. 重启 PiG 后用 /model 选择 Magpie 模型。",
}

export function connect({ gateway, models }) {
  if (!gateway || typeof gateway.v1 !== "string" || !/^https?:\/\/[^\s]+$/.test(gateway.v1) ||
      typeof gateway.key !== "string" || !gateway.key || !Array.isArray(models)) {
    throw new Error("PiG: expected a gateway URL, agent key and model list")
  }

  const seen = new Set()
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
  const catalog = models.map((model) => {
    if (!model || typeof model.id !== "string" || !model.id.trim() || seen.has(model.id)) {
      throw new Error("PiG: model IDs must be nonempty and unique")
    }
    seen.add(model.id)
    const efforts = Array.isArray(model.efforts) ? model.efforts : []
    const reasoning = efforts.some((level) => level !== "none" && levels.includes(level))
    const entry = {
      id: model.id,
      name: typeof model.name === "string" && model.name ? model.name : model.id,
      reasoning,
      input: model.images === true ? ["text", "image"] : ["text"],
    }
    // Omit unknown limits, as Magpie's built-in Pi adapter does.
    if (Number.isInteger(model.context) && model.context > 0) entry.contextWindow = model.context
    if (Number.isInteger(model.output) && model.output > 0) {
      entry.maxTokens = entry.contextWindow ? Math.min(model.output, entry.contextWindow) : model.output
    }
    if (reasoning) {
      entry.thinkingLevelMap = {}
      for (const level of levels) {
        const effort = level === "off" ? "none" : level
        entry.thinkingLevelMap[level] = efforts.includes(effort) ? effort : null
      }
    }
    return entry
  })

  return {
    "providers.magpie.name": "Magpie",
    "providers.magpie.baseUrl": gateway.v1,
    "providers.magpie.api": "openai-responses",
    "providers.magpie.apiKey": gateway.key,
    "providers.magpie.models": catalog,
  }
}
