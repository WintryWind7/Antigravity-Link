/**
 * CDP 连接管理器
 *
 * 通过 Chrome DevTools Protocol 与 Antigravity IDE 通信。
 * 持久化连接模式：WebSocket 建立后长期保持复用，避免频繁重建。
 */

const http = require('http');
const WebSocket = require('ws');

class CDPController {
    constructor(port = 9000) {
        this.port = port;
        this.ws = null;
        this.messageId = 1;
        /** @type {Map<number, {resolve: Function, reject: Function}>} */
        this.pending = new Map();
        this._connected = false;
        this._page = null;
    }

    get connected() {
        return this._connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    get currentPage() {
        return this._page;
    }

    /**
     * HTTP 获取 /json/list 页面列表
     */
    async getPages() {
        return new Promise((resolve) => {
            const url = `http://localhost:${this.port}/json/list`;
            http.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve([]);
                    }
                });
            }).on('error', () => resolve([]));
        });
    }

    /**
     * 连接到指定页面的 WebSocket
     */
    async connect(page) {
        if (!page?.webSocketDebuggerUrl) {
            throw new Error('无效的页面对象，缺少 webSocketDebuggerUrl');
        }

        // 如果已有连接先断开
        if (this.ws) this.disconnect();

        return new Promise((resolve, reject) => {
            const wsUrl = page.webSocketDebuggerUrl;
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                this._connected = true;
                this._page = page;
                console.log(`[CDP] 已连接 -> ${page.title || page.url}`);
                resolve();
            });

            this.ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.id && this.pending.has(msg.id)) {
                        const { resolve, reject } = this.pending.get(msg.id);
                        this.pending.delete(msg.id);
                        if (msg.error) {
                            reject(new Error(msg.error.message));
                        } else {
                            resolve(msg.result);
                        }
                    }
                } catch { /* ignore parse errors */ }
            });

            this.ws.on('close', () => {
                this._connected = false;
                for (const [, { reject }] of this.pending) {
                    reject(new Error('连接已断开'));
                }
                this.pending.clear();
            });

            this.ws.on('error', (err) => {
                this._connected = false;
                reject(err);
            });
        });
    }

    /**
     * 自动连接到第一个匹配的页面
     */
    async autoConnect(filter) {
        const pages = await this.getPages();
        if (pages.length === 0) {
            throw new Error('没有找到可用页面');
        }
        const target = filter ? pages.find(filter) : pages[0];
        if (!target) throw new Error('没有匹配的页面');
        await this.connect(target);
        return target;
    }

    /**
     * 执行 Runtime.evaluate
     */
    evaluate(expression, timeout = 10000) {
        return this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        }, timeout);
    }

    /**
     * 发送任意 CDP 方法调用
     */
    send(method, params = {}, timeout = 10000) {
        if (!this.connected) {
            return Promise.reject(new Error('CDP 未连接'));
        }

        return new Promise((resolve, reject) => {
            const id = this.messageId++;
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`${method} 超时 (${timeout}ms)`));
                }
            }, timeout);

            this.pending.set(id, {
                resolve: (result) => { clearTimeout(timer); resolve(result); },
                reject: (err) => { clearTimeout(timer); reject(err); },
            });

            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._connected = false;
        this._page = null;
        this.pending.clear();
    }
}

module.exports = { CDPController };
