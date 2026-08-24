import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const EXTENSION_NAME = "besoloom";
const EXTENSION_FOLDER = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const PROMPT_KEY = "beso-loom-current-stage";
const CHAT_STATE_KEY = "besoLoom";

const DEFAULT_SETTINGS = {
    enabled: true,
    autoInspect: true,
    inspectEvery: 5,
    strictness: "balanced",
};

const DEFAULT_CHAT_STATE = {
    rawOutline: "",
    nodes: [],
    currentIndex: 0,
    hardLimits: "",
    lastInspectionAssistantCount: 0,
    lastInspectionStatus: "idle",
    lastInspectionNote: "",
    correction: "",
};

let inspectionRunning = false;
let splitRunning = false;

function settings() {
    extension_settings[EXTENSION_NAME] ??= {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[EXTENSION_NAME][key] === undefined) {
            extension_settings[EXTENSION_NAME][key] = value;
        }
    }
    return extension_settings[EXTENSION_NAME];
}

function currentContext() {
    return getContext();
}

function hasActiveChat(context = currentContext()) {
    return Boolean(context?.chatId) || context?.groupId != null || context?.characterId != null;
}

function getChatState({ create = true } = {}) {
    const context = currentContext();
    if (!hasActiveChat(context) || !context.chatMetadata) return null;

    let state = context.chatMetadata[CHAT_STATE_KEY];
    if (!state && create) {
        state = structuredClone(DEFAULT_CHAT_STATE);
        state.lastInspectionAssistantCount = countAssistantMessages(context.chat);
        context.chatMetadata[CHAT_STATE_KEY] = state;
        context.saveMetadataDebounced?.();
    }

    if (!state) return null;
    for (const [key, value] of Object.entries(DEFAULT_CHAT_STATE)) {
        if (state[key] === undefined) state[key] = structuredClone(value);
    }
    state.nodes = normalizeNodes(state.nodes);
    state.currentIndex = clampIndex(state.currentIndex, state.nodes.length);
    return state;
}

function saveChatState(state) {
    const context = currentContext();
    if (!state || !context.chatMetadata) return;
    context.chatMetadata[CHAT_STATE_KEY] = state;
    context.saveMetadataDebounced?.();
}

function normalizeNodes(nodes) {
    if (!Array.isArray(nodes)) return [];
    return nodes
        .map((node, index) => {
            if (typeof node === "string") {
                const goal = node.trim();
                return goal ? { id: index + 1, goal } : null;
            }
            const goal = String(node?.goal ?? node?.text ?? "").trim();
            return goal ? { id: index + 1, goal } : null;
        })
        .filter(Boolean);
}

function clampIndex(index, length) {
    if (!length) return 0;
    return Math.max(0, Math.min(Number(index) || 0, length - 1));
}

function countAssistantMessages(chat = []) {
    return chat.filter((message) => {
        if (!message || message.is_user || message.is_system) return false;
        if (message.extra?.isSmallSys) return false;
        return true;
    }).length;
}

function splitLinesToNodes(text) {
    return String(text || "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、]|[A-Za-z][.)])\s*/, "").trim())
        .filter(Boolean)
        .map((goal, index) => ({ id: index + 1, goal }));
}

function strictnessText(level) {
    if (level === "loose") {
        return "宽松：只在剧情明确撞上未来关键节点、改写关键事实或彻底偏离当前阶段时判定偏航。普通自由发挥不要干预。";
    }
    if (level === "strict") {
        return "严格：持续检查当前阶段目标是否被执行；明显绕开阶段目标、提前触发未来关键节点或改写关键事实时判定偏航，但不要替用户安排具体行动。";
    }
    return "平衡：允许人物、NPC、日常和小事件自由发挥；只有提前触发未来核心剧情、改变关键事实，或已经明显走向与当前主线矛盾的方向时判定偏航。";
}

function buildInjection(state) {
    const cfg = settings();
    if (!cfg.enabled || !state?.nodes?.length) return "";

    const node = state.nodes[state.currentIndex];
    if (!node) return "";

    const lines = [
        "【Beso Loom｜当前剧情阶段】",
        `阶段目标：${node.goal}`,
        "",
        "请把这个目标当作当前叙事方向，而不是待办清单。人物反应、NPC、日常、小事件、台词和过渡可以自然自由发挥。",
        "不要提前触发尚未轮到的主线关键节点，不要擅自改写既定世界事实或关键关系。",
        "不要替用户决定其角色的行动、心理或选择。",
    ];

    if (state.correction) {
        lines.push("", `轻量纠偏：${state.correction}`);
    }
    if (state.hardLimits?.trim()) {
        lines.push("", `本线硬限制：${state.hardLimits.trim()}`);
    }
    return lines.join("\n");
}

function refreshInjection() {
    const context = currentContext();
    const state = getChatState({ create: false });
    const prompt = buildInjection(state);
    context.setExtensionPrompt?.(PROMPT_KEY, prompt, 1, 2, false, 0);
}

function routeForSupervisor(state) {
    return state.nodes
        .map((node, index) => `${index === state.currentIndex ? "→" : "-"} 节点 ${index + 1}: ${node.goal}`)
        .join("\n");
}

function inspectionPrompt(state) {
    const cfg = settings();
    const current = state.nodes[state.currentIndex];
    return `你是 Beso Loom 的幕后剧情监督。你只做状态判断与轻量纠偏，不写正文，不创造新的主线剧情。\n\n完整剧情路线（仅供监督，不得当作要求正文立刻执行的任务表）：\n${routeForSupervisor(state)}\n\n当前节点：${state.currentIndex + 1}/${state.nodes.length}\n当前阶段目标：${current.goal}\n\n监督尺度：${strictnessText(cfg.strictness)}\n${state.hardLimits?.trim() ? `用户硬限制：${state.hardLimits.trim()}\n` : ""}\n判定规则：\n1. ongoing：当前节点仍在自然发展，尚未充分完成。不要因为进展慢就催节点。\n2. completed：最近实际剧情已经实质满足当前阶段目标。只有确实发生了才可判定，不能因为“应该差不多了”就提前完成。\n3. drift：正文提前触发了未来核心节点、改写了关键事实/关系，或已经明显走向与路线冲突的方向。普通支线、NPC、小事件、日常和角色自由发挥不算偏航。\n4. 如果当前节点已完成，一次最多只允许推进一个节点。\n5. 不得替用户角色决定行动。\n\n只输出 JSON，不要 Markdown：\n{"status":"ongoing|completed|drift","note":"一句简短判断","correction":"仅 drift 时给正文的轻量纠偏；其他情况为空字符串"}`;
}

function splitPrompt(rawOutline) {
    return `你是 Beso Loom 的剧情整理助手。把用户给出的剧情大纲粗拆成少量“大节点”，方便长期 RP 分阶段推进。\n\n要求：\n- 只整理用户已经提供的主线，不新增用户没有写过的关键剧情。\n- 节点要大，不要拆成动作清单、NPC 指令或逐场景任务。\n- 相邻内容可以合并成自然阶段。\n- 通常 4-10 个节点即可；原大纲很短时可以更少。\n- 每个节点用一两句话自然描述“这一阶段要走到哪里”。\n- 不要求写前置条件、完成条件或具体转场。\n\n用户大纲：\n${rawOutline}\n\n只输出 JSON，不要 Markdown：\n{"nodes":["节点一","节点二"]}`;
}

function extractJson(text) {
    const raw = String(text ?? "").trim();
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return JSON.parse(raw.slice(start, end + 1));
        }
        throw new Error("监督模型没有返回可解析的 JSON");
    }
}

async function quietJson(prompt, schema) {
    const context = currentContext();
    try {
        const result = await context.generateQuietPrompt?.({
            quietPrompt: prompt,
            quietToLoud: false,
            responseLength: 350,
            jsonSchema: schema,
            removeReasoning: true,
        });
        return extractJson(result);
    } catch (schemaError) {
        console.warn("[Beso Loom] structured quiet generation failed, retrying without schema", schemaError);
        const result = await context.generateQuietPrompt?.({
            quietPrompt: prompt,
            quietToLoud: false,
            responseLength: 350,
            removeReasoning: true,
        });
        return extractJson(result);
    }
}

async function inspectNow({ automatic = false } = {}) {
    if (inspectionRunning) return;
    const state = getChatState({ create: false });
    if (!state?.nodes?.length) {
        if (!automatic) toastr.warning("先保存一条剧情路线。", "Beso Loom");
        return;
    }

    inspectionRunning = true;
    renderStatus();
    try {
        const schema = {
            type: "object",
            additionalProperties: false,
            required: ["status", "note", "correction"],
            properties: {
                status: { type: "string", enum: ["ongoing", "completed", "drift"] },
                note: { type: "string" },
                correction: { type: "string" },
            },
        };
        const result = await quietJson(inspectionPrompt(state), schema);
        const allowed = new Set(["ongoing", "completed", "drift"]);
        const status = allowed.has(result.status) ? result.status : "ongoing";

        state.lastInspectionStatus = status;
        state.lastInspectionNote = String(result.note || "").trim();
        state.correction = status === "drift" ? String(result.correction || "").trim() : "";
        state.lastInspectionAssistantCount = countAssistantMessages(currentContext().chat);

        if (status === "completed" && state.currentIndex < state.nodes.length - 1) {
            state.currentIndex += 1;
            state.correction = "";
            state.lastInspectionNote = `${state.lastInspectionNote || "当前节点已完成"}；已进入节点 ${state.currentIndex + 1}。`;
            if (!automatic) toastr.success(`进入节点 ${state.currentIndex + 1}`, "Beso Loom");
        } else if (status === "completed" && state.currentIndex === state.nodes.length - 1) {
            state.lastInspectionNote = `${state.lastInspectionNote || "当前节点已完成"}；整条路线已到最后节点。`;
        } else if (status === "drift" && !automatic) {
            toastr.warning("检测到偏航，已加入轻量纠偏。", "Beso Loom");
        } else if (!automatic) {
            toastr.info("当前节点继续进行。", "Beso Loom");
        }

        saveChatState(state);
        refreshInjection();
        renderAll();
    } catch (error) {
        console.error("[Beso Loom] inspection failed", error);
        if (!automatic) toastr.error(String(error?.message || error), "Beso Loom 巡检失败");
    } finally {
        inspectionRunning = false;
        renderStatus();
    }
}

async function maybeAutoInspect() {
    const cfg = settings();
    if (!cfg.enabled || !cfg.autoInspect || inspectionRunning) return;
    const state = getChatState({ create: false });
    if (!state?.nodes?.length) return;

    const now = countAssistantMessages(currentContext().chat);
    const interval = Math.max(1, Number(cfg.inspectEvery) || 5);
    if (now - Number(state.lastInspectionAssistantCount || 0) >= interval) {
        await inspectNow({ automatic: true });
    }
}

async function aiSplitOutline() {
    if (splitRunning) return;
    const state = getChatState();
    if (!state) {
        toastr.warning("先打开一个聊天。", "Beso Loom");
        return;
    }
    const raw = String($("#besoloom_outline").val() || "").trim();
    if (!raw) {
        toastr.warning("先写入剧情大纲。", "Beso Loom");
        return;
    }

    splitRunning = true;
    $("#besoloom_ai_split").prop("disabled", true).text("正在粗拆…");
    try {
        const schema = {
            type: "object",
            additionalProperties: false,
            required: ["nodes"],
            properties: {
                nodes: { type: "array", minItems: 1, maxItems: 16, items: { type: "string" } },
            },
        };
        const result = await quietJson(splitPrompt(raw), schema);
        const nodes = normalizeNodes(result.nodes || []);
        if (!nodes.length) throw new Error("没有拆出有效节点");

        state.rawOutline = nodes.map((node) => node.goal).join("\n");
        state.nodes = nodes;
        state.currentIndex = 0;
        state.correction = "";
        state.lastInspectionStatus = "idle";
        state.lastInspectionNote = "AI 已粗拆剧情节点，尚未巡检。";
        state.lastInspectionAssistantCount = countAssistantMessages(currentContext().chat);
        saveChatState(state);
        refreshInjection();
        renderAll();
        toastr.success(`已粗拆为 ${nodes.length} 个大节点。`, "Beso Loom");
    } catch (error) {
        console.error("[Beso Loom] outline split failed", error);
        toastr.error(String(error?.message || error), "Beso Loom 粗拆失败");
    } finally {
        splitRunning = false;
        $("#besoloom_ai_split").prop("disabled", false).text("AI 粗拆节点");
    }
}

function saveManualRoute() {
    const state = getChatState();
    if (!state) {
        toastr.warning("先打开一个聊天。", "Beso Loom");
        return;
    }
    const raw = String($("#besoloom_outline").val() || "").trim();
    const nodes = splitLinesToNodes(raw);
    if (!nodes.length) {
        toastr.warning("至少写一个剧情节点。", "Beso Loom");
        return;
    }

    state.rawOutline = raw;
    state.nodes = nodes;
    state.currentIndex = clampIndex(state.currentIndex, nodes.length);
    state.hardLimits = String($("#besoloom_hard_limits").val() || "").trim();
    state.correction = "";
    state.lastInspectionStatus = "idle";
    state.lastInspectionNote = "路线已保存，尚未巡检。";
    state.lastInspectionAssistantCount = countAssistantMessages(currentContext().chat);
    saveChatState(state);
    refreshInjection();
    renderAll();
    toastr.success(`已保存 ${nodes.length} 个大节点。`, "Beso Loom");
}

function saveHardLimits() {
    const state = getChatState();
    if (!state) return;
    state.hardLimits = String($("#besoloom_hard_limits").val() || "").trim();
    saveChatState(state);
    refreshInjection();
}

function moveNode(delta) {
    const state = getChatState({ create: false });
    if (!state?.nodes?.length) return;
    const next = clampIndex(state.currentIndex + delta, state.nodes.length);
    if (next === state.currentIndex) return;
    state.currentIndex = next;
    state.correction = "";
    state.lastInspectionStatus = "manual";
    state.lastInspectionNote = `手动切换到节点 ${next + 1}。`;
    state.lastInspectionAssistantCount = countAssistantMessages(currentContext().chat);
    saveChatState(state);
    refreshInjection();
    renderAll();
}

function renderNodes(state) {
    const box = $("#besoloom_nodes");
    box.empty();
    if (!state?.nodes?.length) {
        box.append('<div class="besoloom_empty">还没有剧情节点。</div>');
        return;
    }

    state.nodes.forEach((node, index) => {
        const item = $("<div>")
            .addClass("besoloom_node")
            .toggleClass("is-current", index === state.currentIndex);
        $("<span>").addClass("besoloom_node_index").text(index + 1).appendTo(item);
        $("<span>").addClass("besoloom_node_text").text(node.goal).appendTo(item);
        box.append(item);
    });
}

function renderStatus() {
    const state = getChatState({ create: false });
    const status = $("#besoloom_status");
    if (!hasActiveChat()) {
        status.text("请先打开一个聊天").attr("data-state", "idle");
        return;
    }
    if (inspectionRunning) {
        status.text("巡检中…").attr("data-state", "working");
        return;
    }
    if (!state?.nodes?.length) {
        status.text("等待剧情路线").attr("data-state", "idle");
        return;
    }
    const labels = { idle: "未巡检", manual: "手动切换", ongoing: "进行中", completed: "已完成", drift: "偏航" };
    status.text(labels[state.lastInspectionStatus] || "进行中").attr("data-state", state.lastInspectionStatus || "idle");
}

function renderAll() {
    const cfg = settings();
    const state = getChatState({ create: false });
    const active = hasActiveChat();

    $("#besoloom_enabled").prop("checked", Boolean(cfg.enabled));
    $("#besoloom_auto_inspect").prop("checked", Boolean(cfg.autoInspect));
    $("#besoloom_interval").val(cfg.inspectEvery);
    $("#besoloom_strictness").val(cfg.strictness);

    $("#besoloom_outline").val(state?.rawOutline || "");
    $("#besoloom_hard_limits").val(state?.hardLimits || "");
    $("#besoloom_chat_controls").find("button, textarea").prop("disabled", !active);

    const count = state?.nodes?.length || 0;
    const current = count ? state.currentIndex + 1 : 0;
    $("#besoloom_position").text(count ? `${current} / ${count}` : "—");
    $("#besoloom_inspection_note").text(state?.lastInspectionNote || "暂无巡检记录。\n");
    renderNodes(state);
    renderStatus();
}

function bindUi() {
    $("#besoloom_enabled").on("input", function () {
        settings().enabled = Boolean($(this).prop("checked"));
        saveSettingsDebounced();
        refreshInjection();
    });

    $("#besoloom_auto_inspect").on("input", function () {
        settings().autoInspect = Boolean($(this).prop("checked"));
        saveSettingsDebounced();
    });

    $("#besoloom_interval").on("change", function () {
        settings().inspectEvery = Math.max(1, Math.min(50, Number($(this).val()) || 5));
        $(this).val(settings().inspectEvery);
        saveSettingsDebounced();
    });

    $("#besoloom_strictness").on("change", function () {
        settings().strictness = String($(this).val() || "balanced");
        saveSettingsDebounced();
    });

    $("#besoloom_save_route").on("click", saveManualRoute);
    $("#besoloom_ai_split").on("click", aiSplitOutline);
    $("#besoloom_hard_limits").on("change", saveHardLimits);
    $("#besoloom_prev").on("click", () => moveNode(-1));
    $("#besoloom_next").on("click", () => moveNode(1));
    $("#besoloom_inspect").on("click", () => inspectNow({ automatic: false }));
}

function bindEvents() {
    const context = currentContext();
    const events = context.eventTypes;
    if (!context.eventSource || !events) return;

    context.eventSource.on(events.MESSAGE_RECEIVED, async () => {
        renderAll();
        await maybeAutoInspect();
    });

    context.eventSource.on(events.CHAT_CHANGED, () => {
        refreshInjection();
        renderAll();
    });

    context.eventSource.on(events.MESSAGE_DELETED, () => renderAll());
    context.eventSource.on(events.MESSAGE_EDITED, () => renderAll());
}

jQuery(async () => {
    settings();
    const html = await $.get(`${EXTENSION_FOLDER}/settings.html`);
    $("#extensions_settings").append(html);
    bindUi();
    bindEvents();
    refreshInjection();
    renderAll();
    console.info("[Beso Loom] v0.1.0 loaded");
});
