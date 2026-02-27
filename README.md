# Antigravity-Link
>由于本人暂时用不到此功能了，因此暂停维护。有需要的可以参考下实现。

通过协议连接到本地Antigravity，配合其他工具可以实现远程类Cli式控制。

## 架构

双层桥接：外部客户端通过 HTTP/WebSocket 连接桥接服务，桥接服务通过 CDP WebSocket 与 Antigravity 通信，并在页面内注入 JavaScript 控制层（`window.__remoteBridge`）执行 DOM 操作。

```
外部客户端 ──HTTP/WS──> LinkServer(:9999) ──CDP WS──> Antigravity(:9000)
                                              └──> window.__remoteBridge
```

## 前置条件

- Node.js
- 需要将 Antigravity 的 CDP 调试端口设置为 9000

## 运行

```bash
# 1. 安装依赖
npm install

# 2. 启动桥接服务
npm start
```

启动后服务监听 `localhost:9999`，提供 HTTP API 和 WebSocket 两种接入方式。

## API

### HTTP

```bash
# 查询连接状态
curl http://localhost:9999/api/status

# 诊断输入框
curl http://localhost:9999/api/diagnose

# 获取全部对话消息
curl http://localhost:9999/api/messages

# 获取最后一条 AI 回复
curl http://localhost:9999/api/lastReply

# 仅设置输入框文本
curl -X POST http://localhost:9999/api/setText -H "Content-Type: application/json" -d "{\"text\":\"你好\"}"

# 仅点击发送
curl -X POST http://localhost:9999/api/pressEnter

# 发送文本并等待 AI 回复（核心接口）
curl -X POST http://localhost:9999/api/send -H "Content-Type: application/json" -d "{\"text\":\"你好\",\"timeout\":60000}"

# 执行任意 JS 表达式
curl -X POST http://localhost:9999/api/evaluate -H "Content-Type: application/json" -d "{\"expression\":\"document.title\"}"

# 等待 AI 回复完成
curl -X POST http://localhost:9999/api/waitForReply -H "Content-Type: application/json" -d "{\"timeout\":60000}"
```

### WebSocket

连接 `ws://localhost:9999/ws`，发送 JSON 指令：

```json
{ "action": "send", "text": "你好", "timeout": 60000 }
{ "action": "setText", "text": "你好" }
{ "action": "pressEnter" }
{ "action": "status" }
{ "action": "messages" }
{ "action": "lastReply" }
{ "action": "diagnose" }
{ "action": "evaluate", "expression": "document.title" }
{ "action": "waitForReply", "timeout": 60000 }
```

## 文件说明

```
src/
├── cdp-controller.js    # CDP 连接管理（持久化 WebSocket 复用）
├── bridge-injector.js   # 页面控制层注入（window.__remoteBridge）
├── input-injector.js    # 输入操作（注入层调用 + CDP Input 域）
├── link-server.js       # HTTP + WebSocket 外部接口
└── index.js             # 入口文件
```
