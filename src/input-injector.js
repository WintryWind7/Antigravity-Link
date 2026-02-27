/**
 * 输入注入器
 *
 * 基于注入的 window.__remoteBridge 控制层和 CDP Input 域，
 * 提供高级输入操作（设置文本、发送、等待回复）。
 *
 * 设计原则：
 *   - DOM 查询/点击等操作通过 callBridge() 调用页面内注入层
 *   - 文本输入通过 CDP Input.insertText（Lexical 编辑器要求）
 *   - 键盘事件通过 CDP Input.dispatchKeyEvent
 *   - Send 按钮可见性作为 AI 空闲/忙碌的判据
 */

const { callBridge, isBridgeAlive, injectBridge } = require('./bridge-injector');

class InputInjector {
    constructor(cdp) {
        this.cdp = cdp;
    }

    /**
     * 确保注入层存在（页面刷新后需要重新注入）
     */
    async ensureBridge() {
        if (!(await isBridgeAlive(this.cdp))) {
            await injectBridge(this.cdp);
        }
    }

    // ── 输入操作 ──

    async focusInput() {
        await this.ensureBridge();
        return await callBridge(this.cdp, 'focusInput');
    }

    async clearInput() {
        await this.focusInput();
        // Ctrl+A 全选
        await this.cdp.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2,
        });
        await this.cdp.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2,
        });
        // Backspace 删除
        await this.cdp.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Backspace', code: 'Backspace',
        });
        await this.cdp.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Backspace', code: 'Backspace',
        });
    }

    async setText(text) {
        await this.ensureBridge();
        await this.clearInput();
        await _sleep(50);

        const focusResult = await this.focusInput();
        if (!focusResult?.success) {
            return { success: false, error: focusResult?.error || '聚焦失败' };
        }

        // 通过 CDP Input 域插入文本（适配 Lexical 编辑器）
        await this.cdp.send('Input.insertText', { text });
        await _sleep(100);

        // 验证
        const actual = await callBridge(this.cdp, 'getInputText');
        return { success: true, text: actual };
    }

    // ── 发送操作 ──

    async clickSend(retries = 10) {
        await this.ensureBridge();
        for (let attempt = 0; attempt < retries; attempt++) {
            const result = await callBridge(this.cdp, 'clickSend');
            if (result?.success) return result;
            if (attempt < retries - 1) await _sleep(1000);
        }
        return { success: false, error: '多次重试后未找到 Send 按钮' };
    }

    async pressEnter() {
        return await this.clickSend();
    }

    async sendText(text, delay = 300) {
        // 先等 AI 空闲
        await this.waitForIdle();

        const setResult = await this.setText(text);
        if (!setResult.success) return setResult;
        await _sleep(delay);

        const sendResult = await this.clickSend();
        return { success: sendResult.success, text, error: sendResult.error };
    }

    // ── 等待操作 ──

    async isSendVisible() {
        await this.ensureBridge();
        return await callBridge(this.cdp, 'isSendVisible');
    }

    async waitForIdle(timeout = 120000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (await this.isSendVisible()) return { success: true };
            await _sleep(1000);
        }
        return { success: false, error: `waitForIdle 超时 (${timeout}ms)` };
    }

    async waitForReply(timeout = 120000, pollInterval = 2000) {
        await this.ensureBridge();
        const start = Date.now();

        // 记录发送前的 bot 消息数量
        const beforeBot = await callBridge(this.cdp, 'getLastBotText');
        const beforeCount = beforeBot?.count || 0;

        // 阶段 1：等 Send 按钮消失（AI 开始处理）
        const phase1Limit = 5000;
        while (Date.now() - start < phase1Limit) {
            if (!(await this.isSendVisible())) break;
            await _sleep(500);
        }

        // 阶段 2：等 Send 按钮重新出现（AI 完成）
        while (Date.now() - start < timeout) {
            await _sleep(pollInterval);
            const elapsed = Math.round((Date.now() - start) / 1000);

            if (await this.isSendVisible()) {
                // 确认不是闪现：等 1.5s 再检查
                await _sleep(1500);
                if (!(await this.isSendVisible())) continue;

                // 检查服务端错误
                const errData = await callBridge(this.cdp, 'checkError');
                if (errData?.hasError) {
                    return { success: false, error: errData.errorText, elapsed };
                }

                // 读取回复
                const afterBot = await callBridge(this.cdp, 'getLastBotText');
                if ((afterBot?.count > beforeCount && afterBot?.text) || afterBot?.text) {
                    return { success: true, reply: afterBot.text, elapsed };
                }
            }
        }

        const { text } = (await callBridge(this.cdp, 'getLastBotText')) || {};
        return { success: false, error: `等待超时 (${timeout}ms)`, reply: text || null };
    }

    // ── 消息读取 ──

    async getMessages() {
        await this.ensureBridge();
        return await callBridge(this.cdp, 'getMessages') || [];
    }

    async getLastBotReply() {
        await this.ensureBridge();
        const data = await callBridge(this.cdp, 'getLastBotText');
        return data?.text || null;
    }

    async diagnose() {
        await this.ensureBridge();
        return await callBridge(this.cdp, 'diagnose') || [];
    }
}

function _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

module.exports = { InputInjector };
