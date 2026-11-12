# 小小科技 AI Gateway

> 一个可自部署的 **OpenAI 兼容 AI 网关 / API 中转平台**：模型目录、按 token 计费、多上游路由与回退、密钥与额度、用量统计、Playground、运营后台，开箱即用。

- **零依赖**：Node.js ≥18 原生 `http`，不需要 `npm install`
- **单文件数据**：`data/db.json`，直接复制即备份
- **前台**：品牌官网 + 用户中心（控制台 / 订阅 / Key / 账单 / 充值 / 邀请 / 文档 / 图片生成 / 视频生成）
- **后台**：16+ 模块，覆盖内容、模型、渠道、计费、用户、订单、工单、客服、日志

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [API 文档](#api-文档)
- [计费模型](#计费模型)
- [上游路由](#上游路由)
- [架构](#架构)
- [目录结构](#目录结构)
- [配置与运维](#配置与运维)
- [路线图](#路线图)

---

## 功能特性

### 网关能力（对标 OpenRouter）

| 能力 | 说明 |
|---|---|
| OpenAI 兼容接口 | `POST /v1/chat/completions`、`POST /api/v1/chat/completions`（等价路径）、`GET /v1/models`、`GET /api/v1/models` |
| 流式输出 | `stream: true`，SSE 逐块下发 |
| 模型目录 | 67 个模型，含上下文长度、模态、能力标签、`pricing`（prompt/completion/request） |
| 按 token 计费 | 固定请求费 + 输入/输出 token 单价（积分 / 1M tokens），支持按次兼容模式 |
| 多上游路由 | 同一模型可挂多个渠道，按优先级 + 权重分流，失败自动回退下一个 |
| 密钥管理 | 每用户多把 `sk-` Key，可设额度、可用模型、有效期、RPM/TPM 限流 |
| 用量统计 | 按天 / 按模型 / 按 Key 聚合，记录 token、费用、耗时、渠道 |
| Playground | 网页直接试模型，实时显示 token 与扣费（`/playground`） |
| 公开价格页 | 67 个模型的价格表，支持搜索/品牌筛选/四种排序（`/pricing`） |
| 公开 API 文档 | 快速开始、参数、错误码、计费规则，示例自动填充当前域名与模型（`/docs`） |
| 运营后台 | 模型定价、渠道、调用日志、用户、订单、工单、在线客服 |
| **充值闭环** | 下单 → 二维码/收银台 → 模拟支付或易支付异步回调 → 到账 → 余额刷新（1 元 = 10 积分，充值赠送 10%） |
| **健康检查与熔断** | 每 60s 探测上游 `/v1/models`，连续失败 3 次自动熔断 5 分钟，后台可手动检测 |
| **预扣与结算** | 调用前按预估 token 冻结额度，返回后按实际 usage 结算，失败释放 |
| **多模态端点** | `POST /v1/embeddings`（512 维）、`POST /v1/images/generations`（支持 n 张） |
| **公开排行榜** | 近 30 天按模型聚合调用量/消耗（`/leaderboard`） |

### 站点能力

- **品牌官网**：首页 / 模型广场 / **价格** / **API 文档** / **Playground** / 关于 / 联系（深色科技风，Canvas 神经元动画）
- **导航设计**：原「能力 / 安全」并入首页「关于」区块（对中转站转化无用，且占满导航位），空出的一级入口让给价格、文档、Playground 三个真正影响转化的页面
- **用户中心**：登录注册、控制台、订阅套餐、我的 Key、积分账单、充值、邀请、API 文档、图片/视频生成
- **在线客服**：自建浮窗，消息落库，后台可回复
- **多货币单位**：内部统一用「积分」结算，1 积分 = 1 元，可自行改成美元

---

## 快速开始

```bash
# 需要 Node.js >= 18
./start.sh
# 或
PORT=8848 USER_PORT=8849 node server/server.js
```

| 入口 | 地址 | 默认账号 |
|---|---|---|
| 品牌官网 | http://127.0.0.1:8848/ | — |
| 用户中心 | http://127.0.0.1:8849/ | `sham / ioioio000` |
| 管理后台 | http://127.0.0.1:8848/admin/ | `admin / admin123` |
| 价格页 | http://127.0.0.1:8848/pricing | 公开 |
| API 文档 | http://127.0.0.1:8848/docs | 公开 |
| Playground | http://127.0.0.1:8849/playground | 需登录 |
| 用量统计 | http://127.0.0.1:8849/usage | 需登录 |

> 首次启动会用 `data/seed.json` 生成 `data/db.json`；登录后台后请立刻改密码。
> 演示账号 `sham` 初始 1000 积分，可直接调用。

### 第一次调用

```bash
# 1. 登录拿会话
curl -c cookie.txt -X POST -H 'content-type: application/json' \
  -d '{"username":"sham","password":"ioioio000"}' http://127.0.0.1:8848/api/user/login

# 2. 签发 Key
KEY=$(curl -s -b cookie.txt -X POST -H 'content-type: application/json' \
  -d '{"name":"cli"}' http://127.0.0.1:8848/api/user/keys \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["key"]["key"])')

# 3. 调用
curl -s -X POST http://127.0.0.1:8848/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"model":"GPT-6-Astra-max","messages":[{"role":"user","content":"hi"}]}'

# 4. 查询用量
curl -s -b cookie.txt 'http://127.0.0.1:8848/api/user/usage?days=7'
```

---

## API 文档

### 认证

所有网关请求使用 Bearer Token：

```
Authorization: Bearer sk-yt-xxxxxxxx
```

### 对话补全

```
POST /v1/chat/completions
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `model` | string | 模型 ID，见 `/v1/models` |
| `messages` | array | `[{role, content}]`，支持 system/user/assistant |
| `stream` | bool | 是否流式（SSE） |
| `temperature` / `top_p` / `max_tokens` | number | 透传给上游 |

响应为标准 OpenAI 结构，`usage` 含 `prompt_tokens` / `completion_tokens`。

错误码：

| HTTP | type | 含义 |
|---|---|---|
| 401 | `invalid_api_key` | Key 无效 |
| 402 | `insufficient_quota` / `quota_exceeded` | 余额不足 / Key 额度用尽 |
| 403 | `key_disabled` / `key_expired` / `model_forbidden` | Key 停用/过期/模型未授权 |
| 429 | `rate_limited` | 超出 RPM/TPM |
| 502 | `upstream_error` | 所有上游失败 |

### 模型列表

```
GET /v1/models
```

返回 OpenRouter 风格字段：`id`、`canonical_slug`、`context_length`、`architecture`、`pricing`、`top_provider`、`supported_parameters`。

### 账户接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/user/register` | 注册（可带 `invite_code`） |
| POST | `/api/user/login` / `logout` | 登录 / 登出 |
| GET | `/api/user/me` | 当前用户与余额 |
| GET | `/api/user/overview` | 概览（Key 数、调用数、花费） |
| GET | `/api/user/usage?days=14` | 用量统计 |
| GET/POST | `/api/user/keys` | Key 列表 / 签发 |
| PUT/DELETE | `/api/user/keys/:id` | 修改 / 删除 Key |
| GET | `/api/user/logs` | 调用日志 |
| GET | `/api/user/recharge/plans` | 充值档位 |
| POST | `/api/user/recharge/create` | 创建充值订单 |
| GET | `/api/user/recharge/status?order=` | 查询订单状态 |
| GET | `/api/user/orders` | 我的订单 |

### 多模态端点

```
POST /v1/embeddings            { "model": "text-embedding-3-small", "input": "hello" }
POST /v1/images/generations    { "model": "image-gen-1", "prompt": "...", "n": 1 }
```

### 支付

- 本地默认走**模拟收银台**：`/pay/:orderId` → 点击即到账
- 接真实易支付：后台「站点设置」保存 `epay.pid` / `epay.key` 后，回调地址 `/api/pay/notify/epay` 会做 MD5 验签并到账

### 客服接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/support/send` | 发送消息（自动建会话） |
| GET | `/api/support/poll?thread_id=` | 拉取会话 |

---

## 计费模型

```
费用 = 固定请求费 + 输入 token × prompt单价 + 输出 token × completion单价
```

- 单价单位：**积分 / 1M tokens**，在后台「模型管理」里可改
- 示例：`GPT-6-Astra-max` 单价 267 积分/1M tokens，一次 5 输入 + 38 输出 ≈ 0.0115 积分
- Key 可设 `quota`：> 0 时按次数限额，= 0 时扣账户余额
- 计费在 `server/platform.js#computeCost`，累计到用户 `balance` 并写 `logs`

---

## 上游路由

1. 取该模型所有启用渠道（`channels.models` 含模型名或 `*`）
2. 按 `priority` 降序分组，同组按 `weight` 加权随机打散
3. 依次尝试：成功即返回；失败标记 `warn` 并回退下一个
4. 全部失败返回 502，并记录最后一次错误

渠道类型：

| type | 说明 |
|---|---|
| `openai` | OpenAI 兼容上游（New API / one-api / 官方 / 任意兼容网关），需填 `base_url` + `api_key` |
| `mock` | 内置演示渠道，返回模拟回复，用于验证计费与日志链路 |

后台「上游渠道」可增删改，支持模型列表、权重、优先级、超时、启用状态。

---

## 架构

```
                    ┌──────────────────────────────┐
  OpenAI SDK  ─────▶│  /v1/chat/completions        │
                    │  鉴权 → 限流 → 路由 → 转发    │
                    │  → 计费 → 日志                │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        上游渠道 A            上游渠道 B            内置 mock
     (OpenAI 兼容 API)     (OpenAI 兼容 API)      (演示/兜底)

  用户中心(8849) ──▶ /api/user/*  ─┐
  管理后台(8848) ──▶ /api/admin/* ─┼──▶ server/platform.js ──▶ data/db.json
  官网(8848) ─────▶ 渲染母版      ─┘
```

服务分三层：

| 层 | 文件 | 职责 |
|---|---|---|
| 路由层 | `server/server.js` | HTTP 分发、鉴权、静态资源、页面渲染调用 |
| 业务层 | `server/platform.js` | 用户/会话/Key/渠道/路由/计费/限流/日志/统计 |
| 渲染层 | `server/render.js`、`render-user.js`、`transform.js` | 页面母版 + 数据替换（品牌名、链接、续杯清理） |

---

## 目录结构

```
.
├── start.sh                  一键启动（8848 官网+后台 / 8849 用户中心）
├── server/
│   ├── server.js             HTTP 服务与路由
│   ├── platform.js           业务核心：用户/Key/渠道/计费/路由/日志
│   ├── store.js              JSON 存储、scrypt 密码、审计、种子数据
│   ├── render.js             官网渲染（模型卡片、品牌 Tab、公告、区块）
│   ├── render-user.js        用户中心渲染
│   ├── user-site.js          用户中心页面 + /?ajax=* 兼容接口
│   └── transform.js          页面后处理（去续杯、链接本地化、客服注入）
├── public/
│   ├── assets/               官网静态资源（CSS/JS/图片）
│   ├── user/assets/          用户中心静态资源
│   ├── pages/                Playground / 用量统计
│   └── admin/                管理后台（单页）
├── data/
│   ├── seed.json             出厂数据（模型/品牌/页面区块/设置）
│   ├── seed-user.json        用户中心页面区块
│   ├── plans-seed.json       订阅套餐卡片
│   ├── video-styles.json     视频生成风格
│   └── db.json               运行时数据库（不入库）
├── tools/                    校验/端到端/截图脚本
└── docs/                     截图与演示素材
```

---

## 配置与运维

- **端口**：`PORT`（默认 8848）、`USER_PORT`（默认 8849）
- **绑定地址**：`HOST`（默认 127.0.0.1，生产改 `0.0.0.0` 并前置 Nginx）
- **备份**：`cp data/db.json backups/db-$(date +%F-%H%M).json`
- **重置**：`rm data/db.json && ./start.sh`
- **迁移**：拷整个目录，无外部依赖
- **后台会话**：Cookie `ytk_sid`（HttpOnly + SameSite=Strict，12h）
- **用户会话**：Cookie `ytk_uid`（HttpOnly + SameSite=Lax，7 天）

生产部署建议：Nginx 反代 + HTTPS + 限流，`data/` 挂载持久卷，定时备份。

---

## 路线图

- [x] OpenAI 兼容网关（chat/completions、models、stream）
- [x] 按 token 计费 + 额度 + 用量统计
- [x] 多上游路由与回退
- [x] 密钥管理 / Playground / 运营后台
- [x] 支付回调（内置模拟收银台 + 易支付验签回调）
- [x] 按 token 的实时余额预扣与结算
- [x] embeddings / images 端点
- [x] 模型健康检查与自动熔断
- [x] 公开模型排行榜
- [ ] 团队与子账号、Key 共享
- [ ] audio（TTS/STT）端点

---

## 说明

- 前端页面参考了公开站点的版式，已替换为自有品牌「小小科技」与自有数据；不含任何第三方私有代码。
- 内置 `mock` 渠道仅用于本地验证计费与日志，生产请配置真实上游。
- 项目使用零第三方依赖，便于审计与二次开发。

## License

MIT
