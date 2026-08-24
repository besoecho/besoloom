import { getContext } from "../../../extensions.js";
import "./index.js";

const FLOAT_ROOT_ID = "besoloom_float_root";
const FLOAT_PREF_KEY = "besoloom:floating-enabled";
const EXTENSION_FOLDER_NAME = "besoloom";
const EXTENSION_EXTERNAL_ID = `third-party/${EXTENSION_FOLDER_NAME}`;

let updateRunning = false;

function core(selector) {
    return document.querySelector(selector);
}

function readFloatEnabled() {
    try {
        return localStorage.getItem(FLOAT_PREF_KEY) !== "false";
    } catch {
        return true;
    }
}

function writeFloatEnabled(enabled) {
    try {
        localStorage.setItem(FLOAT_PREF_KEY, enabled ? "true" : "false");
    } catch {
        // The floating toggle still works for the current page if storage is unavailable.
    }
}

function setFloatingEnabled(enabled) {
    writeFloatEnabled(enabled);
    const root = document.getElementById(FLOAT_ROOT_ID);
    if (root) root.hidden = !enabled;

    const button = core("#besoloom_float_toggle");
    if (button) {
        button.textContent = enabled ? "关闭浮窗" : "开启浮窗";
        button.setAttribute("aria-pressed", String(enabled));
    }
}

function bindSettingsButtons() {
    const floatToggle = core("#besoloom_float_toggle");
    if (floatToggle && floatToggle.dataset.loomBound !== "true") {
        floatToggle.dataset.loomBound = "true";
        floatToggle.addEventListener("click", () => {
            setFloatingEnabled(!readFloatEnabled());
        });
    }

    const updateButton = core("#besoloom_update");
    if (updateButton && updateButton.dataset.loomBound !== "true") {
        updateButton.dataset.loomBound = "true";
        updateButton.addEventListener("click", () => void updateSelf());
    }

    setFloatingEnabled(readFloatEnabled());
}

function dispatchCore(selector, eventName, value, property = "value") {
    const target = core(selector);
    if (!target) return false;
    target[property] = value;
    target.dispatchEvent(new Event(eventName, { bubbles: true }));
    return true;
}

function clickCore(selector, warning = "先打开聊天并保存剧情路线。") {
    const target = core(selector);
    if (!target || target.disabled) {
        globalThis.toastr?.warning?.(warning, "Beso Loom");
        return false;
    }
    target.click();
    return true;
}

function syncValue(floatElement, coreElement) {
    if (!floatElement || !coreElement || document.activeElement === floatElement) return;
    if (floatElement.value !== coreElement.value) floatElement.value = coreElement.value ?? "";
}

function syncFloatingUi(root) {
    bindSettingsButtons();
    root.hidden = !readFloatEnabled();
    if (root.hidden) return;

    const enabled = Boolean(core("#besoloom_enabled")?.checked);
    const statusCore = core("#besoloom_status");
    const position = String(core("#besoloom_position")?.textContent || "—").trim();
    const statusText = String(statusCore?.textContent || "等待剧情路线").trim();
    const statusState = statusCore?.getAttribute("data-state") || "idle";

    root.querySelectorAll("[data-loom-position]").forEach((node) => {
        node.textContent = position;
    });

    const status = root.querySelector("[data-loom-status]");
    if (status) {
        status.textContent = enabled ? statusText : "Beso Loom 已停用";
        status.dataset.state = enabled ? statusState : "disabled";
    }

    const autoCore = core("#besoloom_auto_inspect");
    const intervalCore = core("#besoloom_interval");
    const strictCore = core("#besoloom_strictness");
    const outlineCore = core("#besoloom_outline");
    const limitsCore = core("#besoloom_hard_limits");

    const autoFloat = root.querySelector("#besoloom_float_auto_inspect");
    if (autoFloat && autoCore && document.activeElement !== autoFloat) {
        autoFloat.checked = Boolean(autoCore.checked);
    }
    syncValue(root.querySelector("#besoloom_float_interval"), intervalCore);
    syncValue(root.querySelector("#besoloom_float_strictness"), strictCore);
    syncValue(root.querySelector("#besoloom_float_outline"), outlineCore);
    syncValue(root.querySelector("#besoloom_float_hard_limits"), limitsCore);

    const nodesSource = core("#besoloom_nodes");
    const nodesTarget = root.querySelector("[data-loom-nodes]");
    if (nodesTarget && nodesSource && nodesTarget.innerHTML !== nodesSource.innerHTML) {
        nodesTarget.innerHTML = nodesSource.innerHTML;
    }
    if (nodesTarget && !nodesTarget.innerHTML.trim()) {
        nodesTarget.innerHTML = '<div class="besoloom_float_empty">还没有剧情节点。</div>';
    }

    const note = root.querySelector("[data-loom-note]");
    if (note) {
        note.textContent = String(core("#besoloom_inspection_note")?.textContent || "暂无巡检记录。").trim();
    }

    const mirrorButtons = [
        ["#besoloom_float_save", "#besoloom_save_route"],
        ["#besoloom_float_split", "#besoloom_ai_split"],
        ["#besoloom_float_prev", "#besoloom_prev"],
        ["#besoloom_float_inspect", "#besoloom_inspect"],
        ["#besoloom_float_next", "#besoloom_next"],
    ];
    for (const [floatSelector, coreSelector] of mirrorButtons) {
        const floatButton = root.querySelector(floatSelector);
        const coreButton = core(coreSelector);
        if (!floatButton) continue;
        floatButton.disabled = !enabled || !coreButton || Boolean(coreButton.disabled);
        if (coreButton && floatSelector === "#besoloom_float_split") {
            floatButton.textContent = coreButton.textContent || "AI 粗拆节点";
        }
    }

    root.classList.toggle("is-disabled", !enabled);
}

function commitOutline(root) {
    const outline = root.querySelector("#besoloom_float_outline");
    if (outline) dispatchCore("#besoloom_outline", "input", outline.value);
}

function commitLimits(root) {
    const limits = root.querySelector("#besoloom_float_hard_limits");
    if (limits) dispatchCore("#besoloom_hard_limits", "change", limits.value);
}

async function detectInstallScopes(headers) {
    try {
        const response = await fetch("/api/extensions/discover", { headers });
        if (response.ok) {
            const entries = await response.json();
            const found = Array.isArray(entries)
                ? entries.find((entry) => entry?.name === EXTENSION_EXTERNAL_ID)
                : null;
            if (found?.type === "global") return [true, false];
            if (found?.type === "local") return [false, true];
        }
    } catch (error) {
        console.warn("[Beso Loom] could not detect extension scope", error);
    }
    return [false, true];
}

async function requestUpdate(headers, isGlobal) {
    const response = await fetch("/api/extensions/update", {
        method: "POST",
        headers,
        body: JSON.stringify({ extensionName: EXTENSION_FOLDER_NAME, global: isGlobal }),
    });
    const body = await response.text();
    if (!response.ok) {
        const error = new Error(body || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return body ? JSON.parse(body) : {};
}

async function updateSelf() {
    if (updateRunning) return;
    updateRunning = true;

    const buttons = Array.from(document.querySelectorAll("#besoloom_update, [data-loom-update]"));
    const labels = new Map();
    for (const button of buttons) {
        labels.set(button, button.textContent);
        button.disabled = true;
        if (button.id === "besoloom_update") button.textContent = "正在更新…";
    }

    try {
        const context = getContext();
        const headers = context?.getRequestHeaders?.() || { "Content-Type": "application/json" };
        const scopes = await detectInstallScopes(headers);
        let result = null;
        let lastError = null;

        for (const isGlobal of scopes) {
            try {
                result = await requestUpdate(headers, isGlobal);
                break;
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) throw error;
            }
        }

        if (!result) throw lastError || new Error("没有找到 Beso Loom 的安装目录");

        if (result.isUpToDate) {
            globalThis.toastr?.success?.("已经是最新版本。", "Beso Loom");
        } else {
            const hash = result.shortCommitHash ? `（${result.shortCommitHash}）` : "";
            globalThis.toastr?.success?.(`更新成功${hash}，刷新页面后生效。`, "Beso Loom");
        }
    } catch (error) {
        console.error("[Beso Loom] self update failed", error);
        globalThis.toastr?.error?.(String(error?.message || error), "Beso Loom 更新失败");
    } finally {
        updateRunning = false;
        for (const button of buttons) {
            button.disabled = false;
            if (labels.has(button)) button.textContent = labels.get(button);
        }
    }
}

function createFloatingUi() {
    if (document.getElementById(FLOAT_ROOT_ID)) return;

    const root = document.createElement("div");
    root.id = FLOAT_ROOT_ID;
    root.hidden = !readFloatEnabled();
    root.innerHTML = `
        <button class="besoloom_float_pill" type="button" aria-expanded="false" aria-controls="besoloom_float_panel">
            <span aria-hidden="true">🧵</span>
            <strong>Loom</strong>
            <span class="besoloom_float_pos" data-loom-position>—</span>
        </button>

        <section id="besoloom_float_panel" class="besoloom_float_panel" hidden>
            <header class="besoloom_float_header">
                <div>
                    <strong>Beso Loom｜剧情织机</strong>
                    <span>当前节点 <b data-loom-position>—</b></span>
                </div>
                <div class="besoloom_float_header_actions">
                    <button type="button" data-loom-update title="更新 Beso Loom">↻</button>
                    <button type="button" data-loom-close aria-label="收起浮窗">×</button>
                </div>
            </header>

            <div class="besoloom_float_status" data-loom-status data-state="idle">等待剧情路线</div>

            <section class="besoloom_float_section besoloom_float_runtime">
                <label class="besoloom_float_checkbox">
                    <input id="besoloom_float_auto_inspect" type="checkbox" />
                    <span>自动巡检</span>
                </label>
                <label>
                    <span>每几轮巡检</span>
                    <input id="besoloom_float_interval" type="number" min="1" max="50" step="1" />
                </label>
                <label>
                    <span>监督尺度</span>
                    <select id="besoloom_float_strictness">
                        <option value="loose">宽松</option>
                        <option value="balanced">平衡</option>
                        <option value="strict">严格</option>
                    </select>
                </label>
            </section>

            <section class="besoloom_float_section">
                <label for="besoloom_float_outline"><b>完整剧情脉络</b></label>
                <p class="besoloom_float_hint">一行一个大节点；也可以直接粘整段大纲后让 AI 粗拆。</p>
                <textarea id="besoloom_float_outline" rows="7" placeholder="幼儿园相识&#10;小学慢慢熟起来&#10;高中辛聆去巴黎&#10;大学重逢"></textarea>
                <div class="besoloom_float_dual_actions">
                    <button id="besoloom_float_save" type="button">保存线路</button>
                    <button id="besoloom_float_split" type="button">AI 粗拆节点</button>
                </div>
            </section>

            <section class="besoloom_float_section">
                <label for="besoloom_float_hard_limits"><b>硬限制（可不填）</b></label>
                <textarea id="besoloom_float_hard_limits" rows="3" placeholder="只写确实需要锁死的规则。"></textarea>
            </section>

            <section class="besoloom_float_section">
                <div class="besoloom_float_section_head">
                    <b>剧情节点</b>
                    <span>当前 <b data-loom-position>—</b></span>
                </div>
                <div class="besoloom_float_nodes" data-loom-nodes>
                    <div class="besoloom_float_empty">还没有剧情节点。</div>
                </div>
                <div class="besoloom_float_nav">
                    <button id="besoloom_float_prev" type="button">← 上一节点</button>
                    <button id="besoloom_float_inspect" class="is-primary" type="button">立即巡检</button>
                    <button id="besoloom_float_next" type="button">下一节点 →</button>
                </div>
            </section>

            <section class="besoloom_float_note">
                <b>最近巡检</b>
                <p data-loom-note>暂无巡检记录。</p>
            </section>
        </section>
    `;
    document.body.appendChild(root);

    const pill = root.querySelector(".besoloom_float_pill");
    const panel = root.querySelector(".besoloom_float_panel");
    const setOpen = (open) => {
        panel.hidden = !open;
        pill.setAttribute("aria-expanded", String(open));
        root.classList.toggle("is-open", open);
    };

    pill.addEventListener("click", () => setOpen(panel.hidden));
    root.querySelector("[data-loom-close]")?.addEventListener("click", () => setOpen(false));
    root.querySelector("[data-loom-update]")?.addEventListener("click", () => void updateSelf());

    root.querySelector("#besoloom_float_auto_inspect")?.addEventListener("input", (event) => {
        dispatchCore("#besoloom_auto_inspect", "input", Boolean(event.currentTarget.checked), "checked");
    });
    root.querySelector("#besoloom_float_interval")?.addEventListener("change", (event) => {
        dispatchCore("#besoloom_interval", "change", event.currentTarget.value);
    });
    root.querySelector("#besoloom_float_strictness")?.addEventListener("change", (event) => {
        dispatchCore("#besoloom_strictness", "change", event.currentTarget.value);
    });
    root.querySelector("#besoloom_float_hard_limits")?.addEventListener("change", () => commitLimits(root));

    root.querySelector("#besoloom_float_save")?.addEventListener("click", () => {
        commitOutline(root);
        commitLimits(root);
        clickCore("#besoloom_save_route", "先打开一个聊天。 ");
    });
    root.querySelector("#besoloom_float_split")?.addEventListener("click", () => {
        commitOutline(root);
        clickCore("#besoloom_ai_split", "先打开一个聊天并写入剧情大纲。 ");
    });
    root.querySelector("#besoloom_float_prev")?.addEventListener("click", () => clickCore("#besoloom_prev"));
    root.querySelector("#besoloom_float_inspect")?.addEventListener("click", () => clickCore("#besoloom_inspect"));
    root.querySelector("#besoloom_float_next")?.addEventListener("click", () => clickCore("#besoloom_next"));

    syncFloatingUi(root);
    window.setInterval(() => syncFloatingUi(root), 500);
    console.info("[Beso Loom] floating workspace mounted");
}

function boot() {
    bindSettingsButtons();
    createFloatingUi();
}

if (document.body) {
    boot();
} else {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
}
