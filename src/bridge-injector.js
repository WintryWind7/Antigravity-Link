/**
 * 页面控制层注入
 *
 * 通过 Runtime.evaluate 向 Antigravity 页面注入 window.__remoteBridge 全局对象。
 * 注入后，所有 DOM 操作通过调用 __remoteBridge 的方法完成，避免每次都传大段 JS。
 *
 * 注入内容包括：
 *   - findInput()      查找 Lexical 编辑器
 *   - focusInput()     聚焦编辑器并将光标置于末尾
 *   - isSendVisible()  检查 Send 按钮是否可见
 *   - clickSend()      点击 Send 按钮
 *   - getLastBotText() 获取最后一条 bot 回复
 *   - getMessages()    获取全部对话消息
 *   - checkError()     检查服务端错误
 *   - diagnose()       诊断页面状态
 */

/**
 * 注入到页面的 JS 源码（字符串形式，将通过 Runtime.evaluate 执行）
 */
const BRIDGE_SCRIPT = `
(function() {
    if (window.__remoteBridge && window.__remoteBridge._version === 2) {
        return JSON.stringify({ injected: false, reason: 'already exists' });
    }

    window.__remoteBridge = {
        _version: 2,

        /** 查找 Lexical 编辑器输入框 */
        findInput: function() {
            var el = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
            if (!el) return { found: false };
            var rect = el.getBoundingClientRect();
            return { found: true, w: Math.round(rect.width), h: Math.round(rect.height) };
        },

        /** 聚焦输入框并将光标置于末尾 */
        focusInput: function() {
            var el = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
            if (!el) return { success: false, error: '未找到 Lexical 编辑器' };
            el.focus();
            var sel = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            return { success: true, focused: document.activeElement === el };
        },

        /** 获取输入框当前文本 */
        getInputText: function() {
            var el = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
            return el ? el.textContent : '';
        },

        /** 检查 Send 按钮是否可见 */
        isSendVisible: function() {
            var panel = document.querySelector('.antigravity-agent-side-panel');
            if (!panel) return false;
            var btns = panel.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
                var t = btns[i].textContent.trim();
                if (t === 'Send' || t.indexOf('Send') !== -1) {
                    var rect = btns[i].getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) return true;
                }
            }
            return false;
        },

        /** 点击 Send 按钮 */
        clickSend: function() {
            var panel = document.querySelector('.antigravity-agent-side-panel');
            if (!panel) return { success: false, error: '未找到面板' };
            var btns = panel.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
                var t = btns[i].textContent.trim();
                if (t === 'Send' || t.indexOf('Send') !== -1) {
                    var rect = btns[i].getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        btns[i].click();
                        return { success: true };
                    }
                }
            }
            return { success: false, error: '未找到 Send 按钮' };
        },

        /** 获取最后一条 bot 回复文本 */
        getLastBotText: function() {
            var botEls = document.querySelectorAll('[class*="leading-relaxed"][class*="select-text"]');
            var lastBot = '';
            var count = 0;
            for (var i = 0; i < botEls.length; i++) {
                var rect = botEls[i].getBoundingClientRect();
                if (rect.height > 10) {
                    var clone = botEls[i].cloneNode(true);
                    var styles = clone.querySelectorAll('style');
                    for (var j = 0; j < styles.length; j++) styles[j].remove();
                    lastBot = clone.textContent.trim();
                    count++;
                }
            }
            return { text: lastBot, count: count };
        },

        /** 获取全部对话消息 */
        getMessages: function() {
            var results = [];
            var userEls = document.querySelectorAll('.whitespace-pre-wrap');
            for (var i = 0; i < userEls.length; i++) {
                var rect = userEls[i].getBoundingClientRect();
                if (rect.height > 5) {
                    results.push({ type: 'user', text: userEls[i].textContent });
                }
            }
            var botEls = document.querySelectorAll('[class*="leading-relaxed"][class*="select-text"]');
            for (var i = 0; i < botEls.length; i++) {
                var rect = botEls[i].getBoundingClientRect();
                if (rect.height > 10) {
                    var clone = botEls[i].cloneNode(true);
                    var styles = clone.querySelectorAll('style');
                    for (var j = 0; j < styles.length; j++) styles[j].remove();
                    results.push({ type: 'bot', text: clone.textContent.trim() });
                }
            }
            return results;
        },

        /** 检查是否有服务端错误 */
        checkError: function() {
            var conv = document.querySelector('#conversation');
            if (!conv) return { hasError: false };
            var allDivs = conv.querySelectorAll('div');
            for (var i = 0; i < allDivs.length; i++) {
                var t = allDivs[i].textContent.trim();
                if (t.length < 200 && t.indexOf('Error') !== -1 && t.indexOf('try again') !== -1) {
                    return { hasError: true, errorText: t };
                }
            }
            return { hasError: false };
        },

        /** 诊断页面输入框状态 */
        diagnose: function() {
            var results = [];
            var selectors = [
                '[contenteditable="true"][data-lexical-editor="true"]',
                '[contenteditable="true"]',
                'textarea'
            ];
            for (var s = 0; s < selectors.length; s++) {
                var els = document.querySelectorAll(selectors[s]);
                for (var i = 0; i < els.length; i++) {
                    var rect = els[i].getBoundingClientRect();
                    results.push({
                        selector: selectors[s], index: i, tag: els[i].tagName,
                        visible: rect.width > 0 && rect.height > 0,
                        lexical: !!els[i].getAttribute('data-lexical-editor'),
                        w: Math.round(rect.width), h: Math.round(rect.height)
                    });
                }
            }
            return results;
        }
    };

    return JSON.stringify({ injected: true, version: 2 });
})()
`;

/**
 * 注入控制层到目标页面
 * @param {import('./cdp-controller').CDPController} cdp
 * @returns {Promise<{injected: boolean}>}
 */
async function injectBridge(cdp) {
    const result = await cdp.evaluate(BRIDGE_SCRIPT);
    const data = JSON.parse(result?.result?.value || '{}');
    if (data.injected) {
        console.log('[Bridge] 控制层注入成功 (v2)');
    } else {
        console.log('[Bridge] 控制层已存在，跳过注入');
    }
    return data;
}

/**
 * 检查控制层是否存在
 */
async function isBridgeAlive(cdp) {
    try {
        const result = await cdp.evaluate(
            'JSON.stringify({ alive: !!(window.__remoteBridge && window.__remoteBridge._version === 2) })'
        );
        const data = JSON.parse(result?.result?.value || '{}');
        return !!data.alive;
    } catch {
        return false;
    }
}

/**
 * 调用注入层的方法（返回 JSON 序列化结果）
 */
async function callBridge(cdp, method, ...args) {
    const argsStr = args.map(a => JSON.stringify(a)).join(', ');
    const expr = `JSON.stringify(window.__remoteBridge.${method}(${argsStr}))`;
    const result = await cdp.evaluate(expr);
    const raw = result?.result?.value;
    if (raw === undefined || raw === null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

module.exports = { injectBridge, isBridgeAlive, callBridge, BRIDGE_SCRIPT };
