const STORAGE_KEY = "besoloom:independent-api";
const PANEL_ID = "besoloom_independent_api";
const STYLE_ID = "besoloom_independent_api_style";

const DEFAULT_CONFIG = {
    enabled: false,
    baseUrl: "",
    apiKey: "",
    model: "",
};

let lastFailureNoticeAt = 0;

function readConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

function writeConfig(next) {
    const config = { ...DEFAULT_CONFIG, ...next };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
        console.warn("[Beso Loom] could not persist independent API settings", error);
    }
    syncUi(config);
    return config;
}

function isEnabled() {
    return Boolean(readConfig().enabled);
}

function normalizeEndpoint(value) {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("请填写 API 地址");

    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error("API 地址格式不正确");
    }

    let path = url.pathname.replace(/\/+$/, "");
    if (/\/chat\/completions$/i.test(path)) {
        url.pathname = path;
        return url.toString();
    }
    if (/\/v1$/i.test(path)) {
        url.pathname = `${path}/chat/completions`;
        return url.toString();
    }
    if (!path || path === "/") {
        url.pathname = "/v1/chat/completions";
        return url.toString();
    }

    url.pathname = `${path}/chat/completions`;
    return url.toString();
}

function extractText(payload) {
    const message = payload?.choices?.[0]?.message?.content;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) {
        return message
            .map((part) => {
                if (typeof part === "string") return part;
                if (typeof part?.text === "string") return part.text;
                return "";
            })
            .join("")
            .trim();
    }
    const legacy = payload?.choices?.[0]?.text;
    if (typeof legacy === "string") return legacy;
    return "";
}

function extractJson(text) {
    const raw = String(text ?? "").trim();
    try {
        return JSON.parse(raw);
    } catch {
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
        if (fenced) {
            try {
                return JSON.parse(fenced);
            } catch {
                // Continue to brace extraction.
            }
        }
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return JSON.parse(raw.slice(start, end + 1));
        }
        throw new Error("独立 API 没有返回可解析的 JSON");
    }
}

async function requestText(prompt, { timeoutMs = 30000 } = {}) {
    const config = readConfig();
    if (!config.enabled) throw new Error("独立 API 未开启");
    if (!String(config.model || "").trim()) throw new Error("请填写模型名");

    const endpoint = normalizeEndpoint(config.baseUrl);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    const headers = { "Content-Type": "application/json" };
    if (String(config.apiKey || "").trim()) {
        headers.Authorization = `Bearer ${String(config.apiKey).trim()}`;
    }

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                model: String(config.model).trim(),
                stream: false,
                messages: [
                    {
                        role: "system",
                        content: "You are the private backend model for Beso Loom. Follow the user's requested output format exactly. When JSON is requested, output JSON only without Markdown fences.",
                    },
                    { role: "user", content: String(prompt || "") },
                ],
            }),
        });

        const raw = await response.text();
        let payload = null;
        try {
            payload = raw ? JSON.parse(raw) : null;
        } catch {
            payload = null;
        }

        if (!response.ok) {
            const detail = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
            throw new Error(`HTTP ${response.status}：${String(detail).slice(0, 300)}`);
        }

        const text = extractText(payload);
        if (!text) throw new Error("接口返回成功，但没有找到模型文本");
        return text;
    } catch (error) {
        if (error?.name === "AbortError") throw new Error("请求超时（30 秒）");
        if (error instanceof TypeError && /fetch/i.test(String(error.message))) {
            throw new Error("网络请求失败；如果地址本身可用，通常是浏览器 CORS 限制");
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

async function requestJson(prompt) {
    try {
        return extractJson(await requestText(prompt));
    } catch (error) {
        const now = Date.now();
        if (now - lastFailureNoticeAt > 60000) {
            lastFailureNoticeAt = now;
            globalThis.toastr?.error?.(String(error?.message || error), "Beso Loom 独立 API");
        }
        throw error;
    }
}

async function testConnection() {
    const result = await requestJson('只输出 JSON：{"ok":true,"service":"besoloom"}');
    if (result?.ok !== true) throw new Error("接口已响应，但测试格式不正确");
    return result;
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${PANEL_ID} .besoloom_api_head{display:flex;align-items:center;justify-content:space-between;gap:10px}
#${PANEL_ID} .besoloom_api_head label{display:flex;align-items:center;gap:7px;font-weight:700}
#${PANEL_ID} .besoloom_api_hint{margin:5px 0 0;opacity:.65;font-size:.82em;line-height:1.4}
#${PANEL_ID} .besoloom_api_fields{display:grid;gap:8px;margin-top:10px}
#${PANEL_ID} .besoloom_api_fields[hidden]{display:none!important}
#${PANEL_ID} .besoloom_api_fields label{display:grid!important;gap:4px;align-items:stretch!important}
#${PANEL_ID} .besoloom_api_fields label>span{font-size:.84em;opacity:.8}
#${PANEL_ID} input[type="text"],#${PANEL_ID} input[type="url"],#${PANEL_ID} input[type="password"]{width:100%;min-height:36px;padding:6px 8px;border:1px solid var(--loom-float-border);border-radius:9px;background:rgba(0,0,0,.18);color:inherit;outline:none;box-sizing:border-box}
#${PANEL_ID} .besoloom_api_keyrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}
#${PANEL_ID} .besoloom_api_keyrow button,#${PANEL_ID} .besoloom_api_actions button{min-height:36px;padding:6px 10px;border:1px solid var(--loom-float-border);border-radius:9px;background:rgba(255,255,255,.055);color:inherit;cursor:pointer;white-space:nowrap}
#${PANEL_ID} .besoloom_api_actions{display:flex;align-items:center;justify-content:space-between;gap:8px}
#${PANEL_ID} .besoloom_api_status{font-size:.82em;opacity:.72}
#${PANEL_ID} .besoloom_api_status[data-state="ok"]{opacity:1;font-weight:700}
#${PANEL_ID} .besoloom_api_status[data-state="error"]{opacity:1;font-weight:700}
`;
    document.head.appendChild(style);
}

function setStatus(text, state = "idle") {
    const node = document.querySelector(`#${PANEL_ID} .besoloom_api_status`);
    if (!node) return;
    node.textContent = text;
    node.dataset.state = state;
}

function syncUi(config = readConfig()) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const enabled = panel.querySelector("[data-api-enabled]");
    const baseUrl = panel.querySelector("[data-api-url]");
    const apiKey = panel.querySelector("[data-api-key]");
    const model = panel.querySelector("[data-api-model]");
    const fields = panel.querySelector(".besoloom_api_fields");

    if (enabled) enabled.checked = Boolean(config.enabled);
    if (baseUrl && document.activeElement !== baseUrl) baseUrl.value = config.baseUrl || "";
    if (apiKey && document.activeElement !== apiKey) apiKey.value = config.apiKey || "";
    if (model && document.activeElement !== model) model.value = config.model || "";
    if (fields) fields.hidden = !config.enabled;

    if (!config.enabled) setStatus("沿用酒馆当前模型", "idle");
    else if (!config.baseUrl || !config.model) setStatus("等待填写配置", "idle");
    else setStatus("独立 API 已启用", "idle");
}

function mountUi() {
    if (document.getElementById(PANEL_ID)) return true;
    const floatPanel = document.querySelector("#besoloom_float_root .besoloom_float_panel");
    if (!floatPanel) return false;

    ensureStyle();
    const section = document.createElement("section");
    section.id = PANEL_ID;
    section.className = "besoloom_float_section";
    section.innerHTML = `
        <div class="besoloom_api_head">
            <div>
                <b>独立 API</b>
                <p class="besoloom_api_hint">只用于 AI 粗拆和幕后巡检；关闭时继续用酒馆当前模型。</p>
            </div>
            <label title="启用独立 API">
                <input type="checkbox" data-api-enabled />
                <span>启用</span>
            </label>
        </div>
        <div class="besoloom_api_fields" hidden>
            <label>
                <span>API 地址（OpenAI-compatible）</span>
                <input type="url" data-api-url placeholder="https://example.com/v1" autocomplete="off" />
            </label>
            <label>
                <span>API Key</span>
                <div class="besoloom_api_keyrow">
                    <input type="password" data-api-key placeholder="sk-…" autocomplete="new-password" />
                    <button type="button" data-api-reveal>显示</button>
                </div>
            </label>
            <label>
                <span>模型</span>
                <input type="text" data-api-model placeholder="例如 gpt-4.1-mini" autocomplete="off" />
            </label>
            <div class="besoloom_api_actions">
                <span class="besoloom_api_status" data-state="idle">等待填写配置</span>
                <button type="button" data-api-test>测试连接</button>
            </div>
            <p class="besoloom_api_hint">Key 仅保存在当前浏览器 localStorage，不会写进聊天记录或剧情路线。</p>
        </div>
    `;

    const runtime = floatPanel.querySelector(".besoloom_float_runtime");
    if (runtime?.nextSibling) runtime.parentNode.insertBefore(section, runtime.nextSibling);
    else floatPanel.appendChild(section);

    const collect = () => ({
        ...readConfig(),
        enabled: Boolean(section.querySelector("[data-api-enabled]")?.checked),
        baseUrl: String(section.querySelector("[data-api-url]")?.value || "").trim(),
        apiKey: String(section.querySelector("[data-api-key]")?.value || "").trim(),
        model: String(section.querySelector("[data-api-model]")?.value || "").trim(),
    });

    section.querySelector("[data-api-enabled]")?.addEventListener("change", () => {
        writeConfig(collect());
    });
    for (const selector of ["[data-api-url]", "[data-api-key]", "[data-api-model]"]) {
        section.querySelector(selector)?.addEventListener("change", () => writeConfig(collect()));
    }

    section.querySelector("[data-api-reveal]")?.addEventListener("click", (event) => {
        const input = section.querySelector("[data-api-key]");
        if (!input) return;
        const reveal = input.type === "password";
        input.type = reveal ? "text" : "password";
        event.currentTarget.textContent = reveal ? "隐藏" : "显示";
    });

    section.querySelector("[data-api-test]")?.addEventListener("click", async (event) => {
        writeConfig(collect());
        const button = event.currentTarget;
        const oldText = button.textContent;
        button.disabled = true;
        button.textContent = "测试中…";
        setStatus("正在连接…", "idle");
        try {
            await testConnection();
            setStatus("连接成功", "ok");
            globalThis.toastr?.success?.("独立 API 连接成功。", "Beso Loom");
        } catch (error) {
            setStatus(String(error?.message || error), "error");
            globalThis.toastr?.error?.(String(error?.message || error), "Beso Loom 独立 API");
        } finally {
            button.disabled = false;
            button.textContent = oldText;
        }
    });

    syncUi();
    return true;
}

function startMounting() {
    if (mountUi()) return;
    const observer = new MutationObserver(() => {
        if (mountUi()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 30000);
}

globalThis.BesoLoomIndependentApi = {
    isEnabled,
    readConfig,
    writeConfig,
    requestText,
    requestJson,
    testConnection,
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startMounting, { once: true });
} else {
    startMounting();
}

console.info("[Beso Loom] independent API module loaded");
