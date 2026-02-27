/**
 * 外部通信接口（HTTP + WebSocket 双模式）
 *
 * HTTP API:
 *   POST /api/send          { text, timeout? }   → 发送文本并等待回复
 *   POST /api/setText       { text }             → 仅设置文本
 *   POST /api/pressEnter    {}                   → 仅点击发送
 *   POST /api/evaluate      { expression }       → 执行 JS 表达式
 *   POST /api/waitForReply  { timeout? }         → 等待 AI 回复
 *   GET  /api/status                             → CDP 连接状态
 *   GET  /api/messages                           → 获取全部对话
 *   GET  /api/lastReply                          → 获取最后一条 AI 回复
 *   GET  /api/diagnose                           → 诊断输入框状态
 *
 * WebSocket: ws://localhost:{port}/ws
 *   发送: { action, ...params }
 *   接收: { success, data?, error? }
 */

const http = require('http');
const WebSocket = require('ws');

class LinkServer {
    constructor(cdp, injector, port = 9999) {
        this.cdp = cdp;
        this.injector = injector;
        this.port = port;
        this.httpServer = null;
        this.wss = null;
        /** @type {Set<WebSocket>} */
        this.clients = new Set();
    }

    start() {
        return new Promise((resolve, reject) => {
            // HTTP 服务器
            this.httpServer = http.createServer((req, res) => {
                this._handleHttp(req, res);
            });

            // WebSocket 服务器（挂载在同一个 HTTP 服务器上）
            this.wss = new WebSocket.Server({ server: this.httpServer, path: '/ws' });

            this.wss.on('connection', (ws, req) => {
                const addr = req.socket.remoteAddress;
                console.log(`[Server] WS 客户端连接: ${addr}`);
                this.clients.add(ws);

                ws.send(JSON.stringify({
                    type: 'welcome',
                    cdpConnected: this.cdp.connected,
                    actions: ['send', 'setText', 'pressEnter', 'evaluate', 'waitForReply',
                              'status', 'messages', 'lastReply', 'diagnose'],
                }));

                ws.on('message', async (raw) => {
                    await this._handleWsMessage(ws, raw);
                });

                ws.on('close', () => {
                    this.clients.delete(ws);
                });

                ws.on('error', () => {
                    this.clients.delete(ws);
                });
            });

            this.httpServer.listen(this.port, () => {
                console.log(`[Server] 已启动，端口: ${this.port}`);
                console.log(`[Server]   HTTP API: http://localhost:${this.port}/api/*`);
                console.log(`[Server]   WebSocket: ws://localhost:${this.port}/ws`);
                resolve();
            });

            this.httpServer.on('error', reject);
        });
    }

    // ── HTTP 处理 ──

    async _handleHttp(req, res) {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = req.url.split('?')[0];

        // 路由
        try {
            if (url === '/api/status' && req.method === 'GET') {
                return this._json(res, {
                    success: true,
                    data: {
                        cdpConnected: this.cdp.connected,
                        page: this.cdp.currentPage
                            ? { title: this.cdp.currentPage.title, url: this.cdp.currentPage.url }
                            : null,
                        wsClients: this.clients.size,
                    },
                });
            }

            if (url === '/api/messages' && req.method === 'GET') {
                const messages = await this.injector.getMessages();
                return this._json(res, { success: true, data: messages });
            }

            if (url === '/api/lastReply' && req.method === 'GET') {
                const reply = await this.injector.getLastBotReply();
                return this._json(res, { success: true, data: { reply } });
            }

            if (url === '/api/diagnose' && req.method === 'GET') {
                const diag = await this.injector.diagnose();
                return this._json(res, { success: true, data: diag });
            }

            // POST 路由需要解析 body
            if (req.method === 'POST') {
                const body = await this._readBody(req);

                if (url === '/api/send') {
                    if (!body.text) return this._json(res, { success: false, error: '缺少 text 参数' }, 400);
                    const sendResult = await this.injector.sendText(body.text, body.delay || 300);
                    if (!sendResult.success) {
                        return this._json(res, { success: false, error: sendResult.error });
                    }
                    await _sleep(500);
                    const waitResult = await this.injector.waitForReply(body.timeout || 120000);
                    return this._json(res, waitResult);
                }

                if (url === '/api/setText') {
                    if (!body.text && body.text !== '') return this._json(res, { success: false, error: '缺少 text 参数' }, 400);
                    const result = await this.injector.setText(body.text);
                    return this._json(res, { success: true, data: result });
                }

                if (url === '/api/pressEnter') {
                    const result = await this.injector.pressEnter();
                    return this._json(res, { success: true, data: result });
                }

                if (url === '/api/evaluate') {
                    if (!body.expression) return this._json(res, { success: false, error: '缺少 expression 参数' }, 400);
                    const result = await this.cdp.evaluate(body.expression, body.timeout || 10000);
                    return this._json(res, { success: true, data: result });
                }

                if (url === '/api/waitForReply') {
                    const result = await this.injector.waitForReply(body.timeout || 120000);
                    return this._json(res, result);
                }
            }

            // 404
            this._json(res, { success: false, error: `未知路由: ${req.method} ${url}` }, 404);
        } catch (err) {
            console.error(`[Server] HTTP 错误 (${url}):`, err.message);
            this._json(res, { success: false, error: err.message }, 500);
        }
    }

    _json(res, data, statusCode = 200) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
    }

    _readBody(req) {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                try {
                    resolve(JSON.parse(body || '{}'));
                } catch {
                    resolve({});
                }
            });
        });
    }

    // ── WebSocket 处理 ──

    async _handleWsMessage(ws, raw) {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            this._wsReply(ws, { success: false, error: '无效的 JSON' });
            return;
        }

        const { action, id } = msg;

        try {
            let result;
            switch (action) {
                case 'status':
                    result = { cdpConnected: this.cdp.connected };
                    break;
                case 'setText':
                    result = await this.injector.setText(msg.text);
                    break;
                case 'pressEnter':
                    result = await this.injector.pressEnter();
                    break;
                case 'send':
                    const sendR = await this.injector.sendText(msg.text, msg.delay || 300);
                    if (!sendR.success) { this._wsReply(ws, { success: false, error: sendR.error, id }); return; }
                    await _sleep(500);
                    result = await this.injector.waitForReply(msg.timeout || 120000);
                    break;
                case 'evaluate':
                    result = await this.cdp.evaluate(msg.expression, msg.timeout || 10000);
                    break;
                case 'waitForReply':
                    result = await this.injector.waitForReply(msg.timeout || 120000);
                    break;
                case 'messages':
                    result = await this.injector.getMessages();
                    break;
                case 'lastReply':
                    result = { reply: await this.injector.getLastBotReply() };
                    break;
                case 'diagnose':
                    result = await this.injector.diagnose();
                    break;
                default:
                    this._wsReply(ws, { success: false, error: `未知指令: ${action}`, id });
                    return;
            }
            this._wsReply(ws, { success: true, data: result, id });
        } catch (err) {
            this._wsReply(ws, { success: false, error: err.message, id });
        }
    }

    _wsReply(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    broadcast(data) {
        const msg = JSON.stringify(data);
        for (const ws of this.clients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
    }

    stop() {
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
            this.wss = null;
            console.log('[Server] 已关闭');
        }
    }
}

function _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

module.exports = { LinkServer };
