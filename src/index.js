/**
 * Antigravity-Link 入口文件
 *
 * 启动流程:
 *   1. 通过 CDP 连接到 Antigravity IDE
 *   2. 注入页面控制层 (window.__remoteBridge)
 *   3. 启动 HTTP + WebSocket 服务器，等待外部客户端
 *
 * 架构:
 *   外部客户端 ──HTTP/WS──> LinkServer ──CDP──> Antigravity IDE
 *                                         └─> __remoteBridge (注入层)
 *
 * 用法:
 *   node src/index.js [--cdp-port=9000] [--server-port=9999]
 */

const { CDPController } = require('./cdp-controller');
const { injectBridge } = require('./bridge-injector');
const { InputInjector } = require('./input-injector');
const { LinkServer } = require('./link-server');

function parseArgs() {
    const args = process.argv.slice(2);
    const config = { cdpPort: 9000, serverPort: 9999 };

    for (const arg of args) {
        if (arg.startsWith('--cdp-port=')) {
            config.cdpPort = parseInt(arg.split('=')[1], 10);
        } else if (arg.startsWith('--server-port=')) {
            config.serverPort = parseInt(arg.split('=')[1], 10);
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Antigravity-Link - CDP 远程控制桥接服务

用法: node src/index.js [选项]

选项:
  --cdp-port=PORT      Antigravity 调试端口 (默认: 9000)
  --server-port=PORT   服务器端口 (默认: 9999)

HTTP API:
  POST /api/send          发送文本并等待回复  { text, timeout? }
  POST /api/setText       仅设置文本          { text }
  POST /api/pressEnter    仅点击发送          {}
  POST /api/evaluate      执行 JS 表达式      { expression }
  POST /api/waitForReply  等待 AI 回复        { timeout? }
  GET  /api/status        查询连接状态
  GET  /api/messages      获取全部对话
  GET  /api/lastReply     获取最后一条 AI 回复
  GET  /api/diagnose      诊断输入框

WebSocket: ws://localhost:PORT/ws
  发送 JSON: { action: "send|setText|pressEnter|...", ... }

示例:
  curl http://localhost:9999/api/status
  curl -X POST http://localhost:9999/api/send -d '{"text":"你好"}'
`);
            process.exit(0);
        }
    }
    return config;
}

async function main() {
    const config = parseArgs();

    console.log('╔═══════════════════════════════════════╗');
    console.log('║     Antigravity-Link 桥接服务         ║');
    console.log('╚═══════════════════════════════════════╝');
    console.log(`  CDP 端口:     ${config.cdpPort}`);
    console.log(`  服务器端口:   ${config.serverPort}`);
    console.log();

    // 1. CDP 连接
    const cdp = new CDPController(config.cdpPort);
    let connected = false;

    for (let i = 0; i < 5 && !connected; i++) {
        try {
            if (i > 0) {
                console.log(`[Main] 第 ${i} 次重试...`);
                await new Promise((r) => setTimeout(r, 2000));
            }
            await cdp.autoConnect();
            connected = true;
        } catch (err) {
            console.error(`[Main] 连接失败: ${err.message}`);
        }
    }

    if (!connected) {
        console.error('[Main] 无法连接到 Antigravity');
        process.exit(1);
    }

    // 2. 注入控制层
    await injectBridge(cdp);

    // 3. 启动服务器
    const injector = new InputInjector(cdp);
    const server = new LinkServer(cdp, injector, config.serverPort);
    await server.start();

    console.log('\n[Main] 系统就绪');

    // 优雅退出
    const shutdown = () => {
        console.log('\n[Main] 正在关闭...');
        server.stop();
        cdp.disconnect();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('[Main] 启动失败:', err);
    process.exit(1);
});
