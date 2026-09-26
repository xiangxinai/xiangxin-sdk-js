# 象信 AI JavaScript / TypeScript SDK

`@xiangxinai/sdk` 是 [象信 AI](https://xiangxinai.cn) 的官方 JavaScript / TypeScript SDK，用于调用**象信一号**系统一模型。

象信一号不生成文本：你给它一段**状态（state）**和一组**带类型的问题**，它一次前向就返回带校准概率的结构化答案。

| 原语 | 辅助函数 | 答案字段 |
|---|---|---|
| Noul 是非题 | `noul(instructions, criteria?)` | `.noul`：成立的概率 0–1 |
| Choice 单选题（≤ 255 个选项） | `choice(instructions, criteria)` | `.choice`、`.probabilities`、`.confidence` |
| Score 打分题（2–10 档） | `score(instructions, criteria)` | `.score`、`.legend`、`.probabilities`、`.confidence` |

- 答案类型从问题自动推断：`answers.dept.choice` 的类型就是你写的选项名联合，例如 `'billing' | 'technical'`。
- 零运行时依赖，基于全局 `fetch`：Node.js ≥ 18、Deno、Bun、Cloudflare Workers 等均可使用，也可以传入自定义 `fetch`。
- 同时提供 ESM、CommonJS 与类型声明。
- 自动重试（429 / 529 / 5xx / 连接错误，指数退避加抖动，遵守 `retry-after`）、超时与 `AbortSignal` 取消。

完整文档：<https://docs.xiangxinai.cn/sdk/javascript>

## 安装

```bash
npm install @xiangxinai/sdk
# 或
pnpm add @xiangxinai/sdk
# 或
yarn add @xiangxinai/sdk
```

## 快速开始

在 [控制台 → API 密钥](https://console.xiangxinai.cn/keys) 创建密钥，并设置环境变量：

```bash
export XIANGXIN_API_KEY="sk-xx-..."
```

```ts
import { XiangxinClient, choice, noul, score } from '@xiangxinai/sdk'

const client = new XiangxinClient() // 自动读取 XIANGXIN_API_KEY

const { answers, usage, model } = await client.systemOne({
  state: '我这个月被重复扣费了两次，客服三天都没回复，请尽快处理！',
  questions: {
    is_urgent: noul('这张工单是否需要当天处理？'),
    department: choice('应分派到哪个部门？', {
      billing: '扣费、发票、退款',
      technical: '报错、故障、无法登录',
      sales: '购买咨询、套餐升级',
    }),
    frustration: score('用户的情绪有多激动？', ['平静', '不满', '非常愤怒']),
  },
})

answers.is_urgent.noul          // 0.95
answers.department.choice       // 'billing'，类型为 'billing' | 'technical' | 'sales'
answers.department.confidence   // 0.81
answers.frustration.score       // 1.05
answers.frustration.legend['2'] // '非常愤怒'
console.log(model, usage.input_tokens) // xiangxin-1.0.0 296
```

CommonJS 同样可用：

```js
const { XiangxinClient, noul } = require('@xiangxinai/sdk')
```

问题也可以直接写成对象，与辅助函数完全等价：

```ts
await client.systemOne({
  state: { 标题: '无法登录', 正文: '输入验证码后一直转圈' },
  questions: {
    is_bug: { type: 'noul', instructions: '这是产品缺陷吗？' },
    severity: { type: 'score', instructions: '严重程度', criteria: ['轻微', '一般', '严重'] },
  },
})
```

## 模型

```ts
const models = await client.models.list()
for (const m of models) console.log(m.name, m.release_date, m.description)
```

默认模型为 `xiangxin-latest`。可以用 `new XiangxinClient({ defaultModel })` 或单次调用的 `model` 覆盖。

两个模型家族共用同一个 `systemOne` 接口，只换 `model`：

| 模型 | 常量 | 说明 |
|---|---|---|
| `xiangxin-s1` | `S1_MODEL` | 系统一（象信一号），有世界知识，零样本即可判断 |
| `xiangxin-reflex` | `REFLEX_MODEL` | 基础条件反射，毫秒级、固定耗时，价格为系统一的 1/100 |
| `xiangxin-reflex:<名字>` | `reflexModel('<名字>')` | 用你自己的数据练出来的反射 |

## 条件反射

条件反射用来替代正则：给它 10–50,000 条标注样本，就能练出一个只属于你组织的反射，推理毫秒级、耗时固定。它没有世界知识，适合分流、意图、垃圾 / 敏感检测、格式检查这类“看一眼就该反应”的判断；需要常识或推理的问题请用系统一。

```ts
import { XiangxinClient, choice, noul, reflexModel } from '@xiangxinai/sdk'

const client = new XiangxinClient()
const questions = {
  department: choice('分派部门', { billing: null, technical: null, sales: null }),
  is_urgent: noul('是否需要当天处理？'),
}

await client.reflexes.create({
  name: 'ticket-router',
  description: '工单分流',
  questions,
  examples: [
    // Noul 标 true/false，Choice 标选项名（有类型检查），Score 标档位下标；可以只标部分问题
    { state: '我被重复扣费了两次', answers: { department: 'billing', is_urgent: true } },
    { state: 'App 打不开，一直闪退', answers: { department: 'technical' } },
    // ……至少 10 条
  ],
})

const reflex = await client.reflexes.wait('ticket-router') // 轮询到 ready / failed / cancelled
if (reflex.status === 'ready') console.log(reflex.metrics?.before?.accuracy, '→', reflex.metrics?.after?.accuracy)

const { answers } = await client.systemOne({ state: '退款什么时候到账？', questions, model: reflexModel('ticket-router') })
```

- 同名再 `create` 即**重练**；新版本练好前旧版本照常可用（`reflex.usable`），训练中再次提交会以 `ConflictError`（`reflex_busy`）拒绝。
- `client.reflexes.list()` / `get(name)` / `cancel(name)` / `delete(name)` 管理反射；`wait(name, { pollIntervalMs: 2000, waitTimeoutMs })` 超时以 `WaitTimeoutError` 拒绝，训练失败或被取消时照常返回，请检查 `status`。
- `create` 默认超时不短于 300 秒（请求体上限 50MB），且默认不重试超时，避免重复提交。
- 首次训练尚未完成时用该反射推理会以 `ConflictError`（`reflex_not_ready`）拒绝。

## 读取响应头

```ts
const { data, response, requestId } = await client.systemOne({ state, questions }).withResponse()
response.headers.get('x-xiangxin-model-ms') // 模型耗时（毫秒）
```

## 错误处理

所有错误都继承自 `XiangxinError`：

| 错误类 | 状态码 | 场景 |
|---|---|---|
| `AuthenticationError` | 401 | API 密钥缺失、无效或已禁用 |
| `InsufficientBalanceError` | 402 | 余额不足，请到控制台充值 |
| `PermissionDeniedError` | 403 | 无权访问 |
| `NotFoundError` | 404 | 模型或反射不存在 |
| `ConflictError` | 409 | 反射尚未练好（`reflex_not_ready`）、正在训练（`reflex_busy`）或数量已达上限（`too_many_reflexes`） |
| `RequestTooLargeError` | 413 | 请求体过大（练反射的样本超过 50MB） |
| `UnprocessableEntityError` | 422 | 请求校验失败（选项过多、超出 token 上限等） |
| `RateLimitError` | 429 | 超出速率限制（`.retryAfter` 为建议等待秒数） |
| `OverloadedError` | 529 | 服务过载，稍后重试 |
| `InternalServerError` | 其他 5xx | 服务端错误 |
| `APIConnectionError` / `APITimeoutError` | — | 网络错误 / 超时 |
| `APIUserAbortError` | — | 调用方通过 `AbortSignal` 取消 |

```ts
import { APIError, InsufficientBalanceError } from '@xiangxinai/sdk'

try {
  await client.systemOne({ state, questions })
} catch (err) {
  if (err instanceof InsufficientBalanceError) console.log('余额不足，请充值')
  else if (err instanceof APIError) console.log(err.status, err.detail, err.requestId)
  else throw err
}
```

## 重试、超时与取消

默认对 429、500、502、503、504、529 以及连接错误 / 超时重试 2 次，指数退避加抖动；服务端返回 `retry-after` / `retry-after-ms` 时按其等待（最长 60 秒）。422 等客户端错误不会重试。

```ts
const client = new XiangxinClient({
  timeout: 10_000,                              // 每次尝试的超时（毫秒），默认 120000
  retry: { maxRetries: 4, backoffMaxMs: 4_000 },
})

const controller = new AbortController()
await client.systemOne({ state, questions }, { timeout: 5_000, retry: { maxRetries: 0 }, signal: controller.signal })
```

## 日志

`logLevel` 或环境变量 `XIANGXIN_LOG` 设为 `debug` / `info` / `warn`（默认）/ `error` / `off`。`info` 每个请求输出一行摘要，`debug` 额外输出请求头与正文。`Authorization` 等鉴权头会被隐去，SDK 任何情况下都不会记录 API 密钥。

```ts
const client = new XiangxinClient({ logLevel: 'info', logger: myLogger }) // logger 兼容 console
```

## 环境变量

| 变量 | 作用 | 默认值 |
|---|---|---|
| `XIANGXIN_API_KEY` | API 密钥（必填） | — |
| `XIANGXIN_BASE_URL` | API 根地址 | `https://api.xiangxinai.cn` |
| `XIANGXIN_DEFAULT_MODEL` | 默认模型 | `xiangxin-latest` |
| `XIANGXIN_LOG` | 日志级别 | `warn` |

显式传入的参数优先于环境变量。

> [!WARNING]
> **不要把 API 密钥下发到浏览器。** 密钥属于组织，任何拿到它的人都能以你的组织身份调用并产生费用。请在你自己的服务端（Node.js、边缘函数等）调用象信，再由前端请求你的服务端代理。SDK 检测到浏览器环境时默认拒绝创建客户端；`dangerouslyAllowBrowser: true` 仅适用于内部工具等密钥不会外泄的场景。

## 开发

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
```

## 许可证

Apache-2.0，见 [LICENSE](./LICENSE)。
