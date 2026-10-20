# 测试验证记录

日期：2026-10-20。平台：Windows amd64。插件：`magpie-agent-pig 0.1.0`。

## 环境与结果

| 项目 | 版本 / 结果 |
| --- | --- |
| Magpie | 0.1.1296，构建提交 `2374ffe161439b02a8e7f23b793461b39a635bf8` |
| PiG | 0.5.0，基于 Pi 1.3.0 |
| Node.js | 24.19.0 |
| `npm.cmd test` | 4 个测试通过 |
| Windows 隔离集成 | 9 项检查通过，2 次本地模拟模型请求 |
| 实际 Magpie 模型目录 | 读取 7 个模型，隔离 PiG 全部成功列出，0 次生成请求 |
| `npm.cmd pack --dry-run --json` | 通过；仅包含 package.json、pig.agent.js、README.md、LICENSE |

运行命令见 [README](./README.md#开发与测试)。没有新增 npm 运行时或测试依赖。社区通用检查脚本会跳过 Agent 包，未把它当作验证依据。

## 已验证行为

1. 在隔离配置中安装本地文件夹，Magpie 通过真实 moejs 加载 Agent 描述并显示 PiG。
2. 连接后将模型写入 `providers.magpie`，其他供应商、自定义字段及 PiG 默认设置不变。
3. PiG 原生程序接受生成的 Pi 兼容模型格式，并列出 Magpie 供应商。
4. Magpie 移除模型、增加路由组后，自动同步至 PiG 配置，无需重新连接。
5. `magpie visible pig …` 控制同步到 PiG 的模型可见范围。
6. 真实 PiG → 真实隔离 Magpie 网关 → 本地 Responses 模拟服务，完成 SSE 流式函数调用、真实 `read` 工具执行与最终回复；检查第二轮确实包含文件读取结果。
7. 网关 usage.jsonl 将请求归属于 `pig`。
8. 原先存在 Magpie 配置时，断开恢复原值，其他字段和 PiG settings 保持不变。
9. 原先不存在 Magpie 配置时，断开移除引入的网关键；允许框架留下空对象，PiG 仍能正常加载目录。

单元测试额外覆盖：含斜杠和点的模型 ID、路由组 ID、图片能力、未知上限省略、输出不超过已知上下文、`off → none`、不支持推理档位设为 null、空列表、重复/缺失模型 ID 与无效网关输入。

## 证据位置

- 本地隔离集成结果保存在 `.sandbox/run-*/result.json` 和 `commands.json`。
- 实际模型目录检查结果保存在 `.sandbox/live-catalog-*/result.json` 和 `pig-models.txt`。

沙箱、配置备份及运行日志不提交到公开仓库。重新运行测试即可在本机生成对应证据。

隔离集成前后对真实用户的 Magpie settings/plugins/stash 与 PiG models/settings/auth 文件做 SHA-256 指纹对比，包括文件是否存在；所有指纹一致。测试未复制真实认证或调用订阅模型。沙箱使用随机目录和端口，保留结果便于检查。

## 实际用户环境接入验证

2026-10-20 经用户要求“帮我接入测试”，已在当前 Magpie 注册本地插件并启用 PiG 连接：

```powershell
magpie plugin add .
magpie pig provider magpie
```

结果：Magpie agents 显示 `PiG provider magpie`；PiG models.json 新增 Magpie 供应商，地址为本机网关，使用 Responses API，7 个模型均能由 PiG 列出。PiG settings.json 与接入前 SHA-256 一致，未改变默认模型。

真实链路检查使用 `magpie/codex/gpt-6.1-sol`、low 思考档位，禁用工具、扩展、MCP、技能、上下文文件并关闭会话保存，要求仅返回固定标记。PiG 收到 `PIG_MAGPIE_LIVE_OK`。Magpie usage.jsonl 对应记录为 `agent=pig`、`provider=codex`、`model=gpt-6.1-sol`、HTTP 200、耗时 2297ms、输入 190 tokens、输出 12 tokens。未发送项目文件或执行模型工具。

接入前 plugins.json 和 PiG settings.json 备份及文件存在性记录位于 `.sandbox/live-connect-20261020-195300/`；当时 PiG models.json 不存在。测试后保留插件连接供日常使用，未执行断开。

## 尚未验证与已知边界

- 未操作桌面 GUI；Agent 页面条目与开关使用相同 Agent 框架，但视觉显示未截图验证。
- 已验证一次真实 Codex 订阅生成；真实图片输入和其他供应商协议转换未验证。Responses 工具调用只在本地模拟上游验证。
- 未运行 Linux/macOS 测试、自定义 PiG 路径或 Pi 共享目录模式。
- 插件沿用 Pi 配置格式，但 Agent 扩展输入不含原生协议和价格，统一走 Responses 网关，未复制内置 Pi 适配器的 Go 内部能力。
- PiG 内保存默认模型后再断开，settings 不会由插件改回；需在 PiG 中另选模型。受限 enabledModels 也由 PiG 用户自行维护。
- 无需发布 npm；GitHub topic 发现与社区 registry 推荐列表是不同分发渠道。
