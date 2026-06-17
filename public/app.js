const state = {
  records: [],
  filtered: [],
  selectedId: "",
  status: "全部",
  query: "",
  source: null
};

const $ = (selector) => document.querySelector(selector);

const els = {
  sourceLink: $("#sourceLink"),
  searchInput: $("#searchInput"),
  statusFilters: $("#statusFilters"),
  refreshBtn: $("#refreshBtn"),
  totalCount: $("#totalCount"),
  shownCount: $("#shownCount"),
  mailReadyCount: $("#mailReadyCount"),
  statusSummary: $("#statusSummary"),
  loadingState: $("#loadingState"),
  cards: $("#cards"),
  detailPanel: $("#detailPanel")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusClass(status) {
  if (/已上线|达成|合作/.test(status)) return "done";
  if (/沟通|待定|审核/.test(status)) return "progress";
  if (/已联系/.test(status)) return "contact";
  if (/无法|不合适/.test(status)) return "blocked";
  return "neutral";
}

function compact(value, fallback = "未填写") {
  if (Array.isArray(value)) return value.length ? value.join(", ") : fallback;
  return value ? String(value) : fallback;
}

function formatDateText(value) {
  if (!value) return "";
  if (!String(value).includes("T")) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function loadRecords(refresh = false) {
  els.loadingState.hidden = false;
  els.loadingState.textContent = refresh ? "正在刷新飞书数据..." : "正在读取飞书数据...";
  els.cards.innerHTML = "";
  const response = await fetch(`/api/records${refresh ? "?refresh=1" : ""}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "读取飞书数据失败");

  state.records = data.records || [];
  state.source = data.source;
  els.sourceLink.href = data.source?.url || "#";
  renderFilters(data.statusCounts || {});
  applyFilters();
  els.loadingState.hidden = true;
}

function renderFilters(statusCounts) {
  const entries = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
  els.statusFilters.innerHTML = [
    `<button class="filter-btn ${state.status === "全部" ? "active" : ""}" data-status="全部"><span>全部</span><b>${state.records.length}</b></button>`,
    ...entries.map(([status, count]) => {
      const active = state.status === status ? "active" : "";
      return `<button class="filter-btn ${active}" data-status="${escapeHtml(status)}"><span>${escapeHtml(status)}</span><b>${count}</b></button>`;
    })
  ].join("");
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();
  state.filtered = state.records.filter((record) => {
    const statusOk = state.status === "全部" || record.status === state.status;
    const haystack = [
      record.title,
      record.email,
      record.contact,
      record.status,
      record.note,
      record.language,
      record.cooperation,
      record.country,
      record.tags?.join(" ")
    ]
      .join(" ")
      .toLowerCase();
    return statusOk && (!query || haystack.includes(query));
  }).sort(compareRecords);
  renderMetrics();
  renderSummary();
  renderCards();
  maybeAutoSelect();
}

// 搜索时如果结果唯一，自动打开该 KOL，省去再点一次
function maybeAutoSelect() {
  if (!state.query.trim()) return;
  if (state.filtered.length !== 1) return;
  const only = state.filtered[0];
  if (only && only.recordId !== state.selectedId) {
    selectRecord(only.recordId);
  }
}

// KOL 回复了且我们还没回（KOL 是最后发消息的人 + 有未读）
function needsReply(overview) {
  if (!overview) return false;
  const unread = overview.unreadInboundCount || 0;
  if (!unread) return false;
  const latestInbound = overview.latestInboundTimestamp || 0;
  const latestOverall = overview.latestTimestamp || 0;
  // KOL 的最新消息时间 >= 整体最新消息时间（说明我们还没回）
  return latestInbound >= latestOverall - 60_000; // 60s 容差
}

const STATUS_PRIORITY = {
  "沟通中": 0,
  "需审核": 1,
  "已联系": 2,
  "达成合作": 3,
  "待定": 4,
  "不合适": 5,
  "无法合作": 6
};

function statusPriority(record) {
  return STATUS_PRIORITY[record.status] ?? 3;
}

function compareRecords(a, b) {
  const pa = statusPriority(a);
  const pb = statusPriority(b);
  if (pa !== pb) return pa - pb;
  return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
}

async function loadMailOverviews() {
  try {
    const response = await fetch("/api/mail-overview");
    const data = await response.json();
    if (!response.ok) return;
    const byId = new Map((data.overviews || []).map((item) => [item.recordId, item]));
    state.records = state.records.map((record) => ({
      ...record,
      mailOverview: byId.get(record.recordId) || record.mailOverview
    }));
    applyFilters();
  } catch {
    // Mail overviews are an enhancement; the main table remains usable without them.
  }
}

function renderMetrics() {
  if (els.totalCount) els.totalCount.textContent = state.records.length;
  if (els.shownCount) els.shownCount.textContent = state.filtered.length;
  if (els.mailReadyCount) {
    els.mailReadyCount.textContent = state.records.filter((record) => record.email || record.handle).length;
  }
}

function renderSummary() {
  if (!els.statusSummary) return;
  const counts = state.filtered.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] || 0) + 1;
    return acc;
  }, {});
  els.statusSummary.innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([status, count]) => `<span class="summary-pill"><b>${count}</b> ${escapeHtml(status)}</span>`)
    .join("");
}

function renderCards() {
  if (!state.filtered.length) {
    els.cards.innerHTML = "";
    els.loadingState.hidden = false;
    els.loadingState.textContent = "没有匹配的 KOL。";
    return;
  }
  els.loadingState.hidden = true;
  els.cards.innerHTML = state.filtered
    .map((record) => {
      const tag = (record.tags || [])[0] || "";
      const active = state.selectedId === record.recordId ? "active" : "";
      const lang = [record.language, record.country].filter(Boolean).join("/") || "";
      const meta = [lang, compact(record.cooperation)].filter((v) => v && v !== "未填写").join(" · ");
      return `
        <button class="kol-card ${active}" data-record-id="${escapeHtml(record.recordId)}" type="button">
          <div class="card-row1">
            <strong class="card-name">${escapeHtml(record.title)}</strong>
            <span class="status ${statusClass(record.status)}">${escapeHtml(record.status)}</span>
          </div>
          <div class="card-row2">
            <span class="card-email">${escapeHtml(record.email || record.contact || "无邮箱")}</span>
            ${meta ? `<span class="card-meta">${escapeHtml(meta)}</span>` : ""}
            ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderDetail(record) {
  const metaItems = [
    ["标签",    compact(record.tags)],
    ["负责人",  compact(record.owner)],
    ["语种",    [record.language, record.country].filter(Boolean).join(" / ") || "未填"],
    ["合作",    compact(record.cooperation)],
    ["来源",    compact(record.source)],
    ["更新",    formatDateText(record.updatedAt)]
  ];
  const note = record.note || "";
  els.detailPanel.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <div>
          <h3>${escapeHtml(record.title)}</h3>
          <p>${escapeHtml(record.email || record.contact || "没有邮箱线索")}</p>
        </div>
        <!-- 状态下拉 -->
        <div class="status-picker" data-record-id="${escapeHtml(record.recordId)}">
          <button class="status ${statusClass(record.status)} status-trigger" type="button">
            ${escapeHtml(record.status)} ▾
          </button>
          <div class="status-dropdown" hidden>
            ${["沟通中","需审核","已联系","达成合作","待定","不合适","无法合作"].map((s) =>
              `<button class="status-option ${s === record.status ? "current" : ""}" data-status="${escapeHtml(s)}" type="button">${escapeHtml(s)}</button>`
            ).join("")}
          </div>
        </div>
      </div>
      <div class="detail-actions">
        ${record.homepage ? `<a class="action-link" href="${escapeHtml(record.homepage)}" target="_blank" rel="noreferrer">打开主页</a>` : ""}
        <a class="action-link" href="${escapeHtml(state.source?.url || "#")}" target="_blank" rel="noreferrer">打开飞书</a>
        <button class="copy-button assist-button" type="button" data-assist="analyze" data-record-id="${escapeHtml(record.recordId)}">分析账号</button>
        ${record.email ? `<button class="copy-button" type="button" data-copy="${escapeHtml(record.email)}">复制邮箱</button>` : ""}
      </div>
    </div>
    <div class="detail-meta">
      <div class="meta-strip">
        ${metaItems.map(([label, value]) => `
          <span class="meta-item"><label>${escapeHtml(label)}</label><b>${escapeHtml(value)}</b></span>
        `).join("")}
        <!-- 备注：点击胶囊即可编辑，超长省略，悬停显示完整内容 -->
        <button class="meta-note-chip ${note ? "" : "empty"}" id="noteChip" type="button"
          data-record-id="${escapeHtml(record.recordId)}"
          ${note ? `data-tip="${escapeHtml(note)}"` : ""}>
          <label>备注</label>
          <span class="meta-note-text" id="noteText">${escapeHtml(note || "点击添加")}</span>
        </button>
      </div>
      <!-- 备注编辑器（点击上方胶囊展开） -->
      <div class="meta-note-editor" id="noteEditor" hidden>
        <textarea class="note-textarea" id="noteTextarea" placeholder="输入备注...">${escapeHtml(note)}</textarea>
        <div class="note-editor-actions">
          <button class="note-save-btn" id="noteSaveBtn" type="button" data-record-id="${escapeHtml(record.recordId)}">保存</button>
          <button class="note-cancel-btn" id="noteCancelBtn" type="button">取消</button>
          <span class="note-save-status" id="noteSaveStatus"></span>
        </div>
      </div>
    </div>
    <div class="detail-chat-wrapper">
      <div class="detail-chat" id="chatContent">
        <section id="mailSection">
          <div class="mail-loading">正在搜索飞书邮件...</div>
        </section>
        <section id="assistSection" class="assist-section" style="display:none">
          <div class="section-title"><h4>账号分析</h4><span>先生成，再人工确认</span></div>
          <div class="mail-loading">点击上方按钮生成分析。</div>
        </section>
      </div>

      <div class="draft-preview" id="draftPreview" hidden>
        <div class="draft-preview-header">
          <span class="draft-preview-label">回复草稿预览</span>
          <div class="draft-preview-actions">
            <button class="draft-btn draft-btn-approve" id="approveDraftBtn" type="button">通过，创建飞书草稿</button>
            <button class="draft-btn draft-btn-copy" id="copyDraftBtn" type="button">复制文本</button>
            <button class="draft-btn draft-btn-cancel" id="cancelDraftBtn" type="button">关闭</button>
          </div>
        </div>
        <div class="draft-preview-meta" id="draftMeta"></div>
        <div class="draft-preview-body" id="draftBody"></div>
        <div class="draft-feishu-link" id="draftFeishuLink" hidden></div>
      </div>

      <div class="compose-bar">
        <textarea
          id="composeInput"
          class="compose-textarea"
          placeholder="描述你的回复意图，如：接受他的报价，询问档期..."
          rows="2"
        ></textarea>
        <div class="agent-toggle" role="group" aria-label="选择 Agent">
          <button class="agent-btn active" data-agent="claude" type="button">Claude</button>
          <button class="agent-btn" data-agent="codex" type="button">Codex</button>
        </div>
        <button id="generateDraftBtn" class="compose-send-btn" type="button" data-record-id="${escapeHtml(record.recordId)}" data-agent="claude">
          生成草稿
        </button>
      </div>
    </div>
  `;
  loadMail(record.recordId);
}

async function loadMail(recordId) {
  const mailSection = $("#mailSection");
  try {
    const response = await fetch(`/api/mail?recordId=${encodeURIComponent(recordId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "邮件读取失败");
    mailSection.innerHTML = renderMail(data);
  } catch (error) {
    mailSection.innerHTML = `
      <div class="section-title"><h4>邮件往来</h4></div>
      <div class="notice">${escapeHtml(error.message)}</div>
    `;
  }
}

function renderMail(data) {
  const threads = data.threads || [];
  const threadHtml = threads.map(renderThread).join("");
  const inboundText = data.inboundCount ? `${data.inboundCount} 封 KOL 回复` : "暂无 KOL 回复";
  const unreadText = data.unreadInboundCount ? `，${data.unreadInboundCount} 封未读` : "";
  return `
    <div class="section-title">
      <h4>邮件往来</h4>
      <span>${escapeHtml(inboundText + unreadText)} · 搜索：${escapeHtml(data.query || "无")}</span>
    </div>
    ${data.warning ? `<div class="notice">${escapeHtml(data.warning)}</div>` : ""}
    <div class="chat-mail">
      ${threadHtml || '<div class="mail-loading">没有找到相关邮件。</div>'}
    </div>
  `;
}

const BUBBLE_PREVIEW_LEN = 160;

function renderThread(thread) {
  const messages = thread.relevantMessages || [];
  return `
    <article class="chat-thread">
      <div class="chat-thread-head">
        <span>${escapeHtml(thread.subject || "无主题")}</span>
        <small>${messages.length} 封相关 / ${thread.totalMessages || 0} 封会话${thread.hiddenMessages ? `，隐藏 ${thread.hiddenMessages} 封` : ""}</small>
      </div>
      <div class="chat-stream">
        ${
          messages
            .map((message) => {
              const mine = message.isMine || message.folder === "SENT" || message.state === "sent";
              const who = mine ? "我" : "KOL";
              const full = message.preview || "";
              const isLong = full.length > BUBBLE_PREVIEW_LEN;
              const preview = isLong ? full.slice(0, BUBBLE_PREVIEW_LEN) : full;
              const msgId = message.messageId || "";
              return `
              <div class="chat-row ${mine ? "mine" : "theirs"}">
                <div class="chat-avatar" aria-hidden="true">${mine ? "我" : "K"}</div>
                <div class="chat-stack">
                  <div class="chat-meta">
                    <strong>${escapeHtml(who)}</strong>
                    <span>${escapeHtml(message.from || "未知发件人")}</span>
                    <time>${escapeHtml(message.date || "")}</time>
                  </div>
                  <div class="chat-bubble ${msgId ? "has-full" : ""}"
                    ${msgId ? `data-message-id="${escapeHtml(msgId)}"` : ""}
                    data-subject="${escapeHtml(thread.subject || "")}"
                    data-from="${escapeHtml(message.from || "")}"
                    data-date="${escapeHtml(message.date || "")}">
                    <p class="bubble-text">${escapeHtml(preview)}${isLong ? '<span class="bubble-ellipsis"> …</span>' : ""}</p>
                    ${isLong || msgId ? '<span class="bubble-open-hint">点击查看完整邮件</span>' : ""}
                    <div class="message-flags">
                      ${message.folder ? `<span class="flag">${escapeHtml(message.folder)}</span>` : ""}
                      ${message.unread ? '<span class="flag">未读</span>' : ""}
                      ${message.important ? '<span class="flag">重要</span>' : ""}
                      ${message.attachments?.length ? `<span class="flag">附件 ${message.attachments.length}</span>` : ""}
                    </div>
                  </div>
                </div>
              </div>
            `;
            })
            .join("") || '<div class="mail-loading">这个会话没有匹配当前 KOL 的邮件内容。</div>'
        }
      </div>
    </article>
  `;
}

async function runAssist(type, recordId, button) {
  const assistSection = $("#assistSection");
  const label = type === "draft" ? "起草回复" : "分析账号";
  button.disabled = true;
  button.textContent = "生成中...";
  assistSection.style.display = "";
  assistSection.innerHTML = `
    <div class="section-title"><h4>Codex 建议</h4><span>${label}</span></div>
    <div class="mail-loading">Codex 正在读取当前 KOL 的表格状态、邮件沟通和可用频道线索...</div>
  `;
  try {
    const response = await fetch(`/api/codex/${type}?recordId=${encodeURIComponent(recordId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成失败");
    assistSection.innerHTML = renderAssistResult(data, label);
  } catch (error) {
    assistSection.innerHTML = `
      <div class="section-title"><h4>Codex 建议</h4><span>${label}</span></div>
      <div class="notice">${escapeHtml(error.message)}</div>
    `;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function renderAssistResult(data, label) {
  const fallback = data.promptFallback || "";
  const result = data.result || "";
  const warning = data.warning || "";
  return `
    <div class="section-title"><h4>Codex 建议</h4><span>${escapeHtml(label)}</span></div>
    ${warning ? `<div class="notice">${escapeHtml(warning)}</div>` : ""}
    ${
      result
        ? `<div class="assist-result">${escapeHtml(result)}</div>
           <button class="copy-button assist-copy" type="button" data-copy="${escapeHtml(result)}">复制结果</button>`
        : `<div class="notice">已生成可交给 Codex 的上下文。你可以复制后发给当前 Codex 会话继续处理。</div>`
    }
    ${
      fallback
        ? `<details class="prompt-box">
             <summary>查看/复制给 Codex 的完整上下文</summary>
             <pre>${escapeHtml(fallback)}</pre>
             <button class="copy-button assist-copy" type="button" data-copy="${escapeHtml(fallback)}">复制上下文</button>
           </details>`
        : ""
    }
  `;
}

function selectRecord(recordId) {
  state.selectedId = recordId;
  renderCards();
  const record = state.records.find((item) => item.recordId === recordId);
  if (record) renderDetail(record);
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  applyFilters();
});

// 快捷键 Cmd+F / Ctrl+F：激活搜索框（覆盖浏览器默认查找）
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && (event.key === "f" || event.key === "F")) {
    event.preventDefault();
    els.searchInput?.focus();
    els.searchInput?.select();
  }
});

els.statusFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button) return;
  state.status = button.dataset.status;
  renderFilters(state.records.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] || 0) + 1;
    return acc;
  }, {}));
  applyFilters();
});

els.cards.addEventListener("click", (event) => {
  const card = event.target.closest("[data-record-id]");
  if (card) selectRecord(card.dataset.recordId);
});

// ─── 悬停提示（自定义，挂在 body 上，即时丝滑，不被面板裁切） ──────────────────
const tipEl = document.createElement("div");
tipEl.className = "hover-tip";
tipEl.hidden = true;
document.body.appendChild(tipEl);

let tipTarget = null;

function positionTip(target) {
  const r = target.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  const margin = 8;
  // 水平：与目标左对齐，但不超出视口
  let left = Math.min(r.left, window.innerWidth - tw - 12);
  left = Math.max(12, left);
  // 垂直：默认显示在下方，空间不足则放到上方
  let top = r.bottom + margin;
  if (top + th > window.innerHeight - 12) {
    top = Math.max(12, r.top - th - margin);
  }
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}

function showTip(target) {
  const text = target.getAttribute("data-tip");
  if (!text) return;
  tipTarget = target;
  tipEl.textContent = text;
  tipEl.hidden = false;
  positionTip(target);
  requestAnimationFrame(() => tipEl.classList.add("show"));
}

function hideTip() {
  tipTarget = null;
  tipEl.classList.remove("show");
  tipEl.hidden = true;
}

document.addEventListener("mouseover", (event) => {
  const target = event.target.closest?.("[data-tip]");
  if (target && target !== tipTarget) showTip(target);
});

document.addEventListener("mouseout", (event) => {
  const target = event.target.closest?.("[data-tip]");
  if (target && (!event.relatedTarget || !target.contains(event.relatedTarget))) hideTip();
});

window.addEventListener("scroll", () => { if (tipTarget) hideTip(); }, true);

// ─── 邮件弹窗 ─────────────────────────────────────────────────────────────────
const mailModal = document.createElement("div");
mailModal.className = "mail-modal";
mailModal.setAttribute("role", "dialog");
mailModal.setAttribute("aria-modal", "true");
mailModal.hidden = true;
mailModal.innerHTML = `
  <div class="mail-modal-backdrop"></div>
  <div class="mail-modal-panel">
    <div class="mail-modal-header">
      <div class="mail-modal-meta">
        <p class="mail-modal-subject" id="modalSubject"></p>
        <p class="mail-modal-from" id="modalFrom"></p>
      </div>
      <button class="mail-modal-close" id="modalClose" type="button" aria-label="关闭">✕</button>
    </div>
    <div class="mail-modal-body" id="modalBody">
      <div class="mail-modal-loading">加载中...</div>
    </div>
  </div>
`;
document.body.appendChild(mailModal);

function openMailModal(bubble) {
  const messageId = bubble.dataset.messageId;
  const subject = bubble.dataset.subject || "";
  const from = bubble.dataset.from || "";

  document.getElementById("modalSubject").textContent = subject;
  document.getElementById("modalFrom").textContent = from;
  document.getElementById("modalBody").innerHTML = '<div class="mail-modal-loading">加载中...</div>';
  mailModal.hidden = false;
  document.body.style.overflow = "hidden";

  if (!messageId) {
    // 没有 messageId，只显示已有 preview
    const text = bubble.querySelector(".bubble-text")?.textContent || "";
    renderModalContent({ text, html: "" });
    return;
  }

  fetch(`/api/mail-message?messageId=${encodeURIComponent(messageId)}`)
    .then((r) => r.json())
    .then((data) => renderModalContent(data))
    .catch((err) => {
      document.getElementById("modalBody").innerHTML =
        `<div class="mail-modal-error">加载失败：${escapeHtml(err.message)}</div>`;
    });
}

function renderModalContent({ html, text }) {
  const body = document.getElementById("modalBody");
  if (html && html.trim()) {
    // 用 sandbox iframe 渲染富文本，防止 XSS
    const iframe = document.createElement("iframe");
    iframe.className = "mail-modal-iframe";
    iframe.setAttribute("sandbox", "allow-same-origin");
    iframe.setAttribute("title", "邮件正文");
    body.innerHTML = "";
    body.appendChild(iframe);
    // 写入后调整高度
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8">
      <style>
        body { margin: 0; padding: 16px 20px; font: 14px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #16191f; background: transparent; word-break: break-word; }
        a { color: #4d5866; }
        img { max-width: 100%; height: auto; }
        blockquote { margin: 8px 0 8px 16px; padding-left: 12px; border-left: 3px solid rgba(101,112,128,.24); color: #6f7782; }
        pre, code { font-family: ui-monospace, Menlo, monospace; font-size: 13px; background: rgba(245,247,250,.82); border-radius: 4px; padding: 2px 5px; }
        pre { padding: 10px 14px; overflow-x: auto; }
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 1px solid rgba(101,112,128,.18); padding: 6px 10px; text-align: left; }
      </style>
    </head><body>${html}</body></html>`);
    doc.close();
    // 动态撑开 iframe 高度
    iframe.onload = () => {
      try {
        iframe.style.height = iframe.contentDocument.body.scrollHeight + "px";
      } catch {}
    };
    setTimeout(() => {
      try { iframe.style.height = iframe.contentDocument.body.scrollHeight + "px"; } catch {}
    }, 200);
  } else {
    // 纯文本 / markdown-like
    body.innerHTML = `<pre class="mail-modal-text">${escapeHtml(text || "（无正文）")}</pre>`;
  }
}

function closeMailModal() {
  mailModal.hidden = true;
  document.body.style.overflow = "";
}

document.getElementById("modalClose").addEventListener("click", closeMailModal);
mailModal.querySelector(".mail-modal-backdrop").addEventListener("click", closeMailModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMailModal(); });

// 气泡点击 → 打开弹窗
els.detailPanel.addEventListener("click", (event) => {
  const bubble = event.target.closest(".chat-bubble.has-full");
  if (bubble) { openMailModal(bubble); return; }
});

// ─── 状态下拉 ─────────────────────────────────────────────────────────────────
els.detailPanel.addEventListener("click", (event) => {
  // 打开/关闭下拉
  const trigger = event.target.closest(".status-trigger");
  if (trigger) {
    const picker = trigger.closest(".status-picker");
    const dropdown = picker?.querySelector(".status-dropdown");
    if (dropdown) dropdown.hidden = !dropdown.hidden;
    return;
  }
  // 点击选项
  const option = event.target.closest(".status-option");
  if (option) {
    const picker = option.closest(".status-picker");
    const recordId = picker?.dataset.recordId;
    const newStatus = option.dataset.status;
    if (!recordId || !newStatus) return;
    picker.querySelector(".status-dropdown").hidden = true;
    updateRecordField(recordId, { status: newStatus }).catch((err) => console.error("状态更新失败:", err.message));
    return;
  }
  // 点外部关闭
  if (!event.target.closest(".status-picker")) {
    document.querySelectorAll(".status-dropdown").forEach((d) => { d.hidden = true; });
  }
});

// ─── 备注编辑 ─────────────────────────────────────────────────────────────────
// 把备注胶囊刷新成最新内容（截断由 CSS 处理，完整内容放 title 供悬停提示）
function refreshNoteChip(note) {
  const chip = $("#noteChip");
  const noteText = $("#noteText");
  if (noteText) noteText.textContent = note ? note : "点击添加";
  if (chip) {
    if (note) chip.setAttribute("data-tip", note);
    else chip.removeAttribute("data-tip");
    chip.classList.toggle("empty", !note);
    chip.style.display = "";
  }
  const editor = $("#noteEditor");
  if (editor) editor.hidden = true;
  hideTip();
}

function openNoteEditor() {
  const editor = $("#noteEditor");
  const chip = $("#noteChip");
  if (chip) chip.style.display = "none";
  if (editor) editor.hidden = false;
  $("#noteTextarea")?.focus();
}

els.detailPanel.addEventListener("click", async (event) => {
  // 点击备注胶囊任意位置 → 进入编辑
  if (event.target.closest("#noteChip")) {
    openNoteEditor();
    return;
  }
  if (event.target.closest("#noteCancelBtn")) {
    const record = state.records.find((r) => r.recordId === $("#noteSaveBtn")?.dataset.recordId);
    refreshNoteChip(record?.note || "");
    return;
  }
  if (event.target.closest("#noteSaveBtn")) {
    const btn = $("#noteSaveBtn");
    const recordId = btn?.dataset.recordId;
    const textarea = $("#noteTextarea");
    if (!recordId || !textarea) return;

    const newNote = textarea.value;
    btn.disabled = true;
    btn.textContent = "保存中...";

    try {
      const res = await fetch("/api/update-record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId, note: newNote })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新失败");

      // 保存成功：更新本地状态并收起编辑器
      const record = state.records.find((r) => r.recordId === recordId);
      if (record) record.note = newNote;
      btn.textContent = "✓ 已保存";
      setTimeout(() => {
        refreshNoteChip(newNote);
        btn.textContent = "保存";
        btn.disabled = false;
      }, 700);
    } catch (err) {
      btn.textContent = "保存失败：" + err.message;
      btn.style.background = "var(--s-blocked-bg)";
      btn.style.color = "var(--s-blocked)";
      setTimeout(() => {
        btn.textContent = "保存";
        btn.style.background = "";
        btn.style.color = "";
        btn.disabled = false;
      }, 2500);
    }
    return;
  }
});

async function updateRecordField(recordId, fields) {
  // 乐观更新本地状态
  const record = state.records.find((r) => r.recordId === recordId);
  if (!record) return;
  if (fields.status !== undefined) {
    record.status = fields.status;
    // 更新 header 里的状态按钮
    const trigger = document.querySelector(".status-trigger");
    if (trigger) {
      trigger.className = `status ${statusClass(fields.status)} status-trigger`;
      trigger.textContent = fields.status + " ▾";
    }
    // 更新列表卡片
    renderCards();
  }
  if (fields.note !== undefined) {
    record.note = fields.note;
    refreshNoteChip(fields.note || "");
  }
  // 同步到飞书（抛出错误让调用方处理）
  const res = await fetch("/api/update-record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recordId, ...fields })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "更新失败");
}

// ─── Agent 切换器 ─────────────────────────────────────────────────────────────
els.detailPanel.addEventListener("click", (event) => {
  const agentBtn = event.target.closest(".agent-btn");
  if (!agentBtn) return;
  const bar = agentBtn.closest(".compose-bar");
  if (!bar) return;
  bar.querySelectorAll(".agent-btn").forEach((b) => b.classList.remove("active"));
  agentBtn.classList.add("active");
  const generateBtn = bar.querySelector("#generateDraftBtn");
  if (generateBtn) generateBtn.dataset.agent = agentBtn.dataset.agent;
});

// ─── 详情面板点击事件 ─────────────────────────────────────────────────────────
els.detailPanel.addEventListener("click", async (event) => {
  // 分析账号按钮
  const assistButton = event.target.closest("[data-assist]");
  if (assistButton) {
    await runAssist(assistButton.dataset.assist, assistButton.dataset.recordId, assistButton);
    return;
  }
  // 复制邮箱
  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    await navigator.clipboard.writeText(copyButton.dataset.copy);
    const old = copyButton.textContent;
    copyButton.textContent = "已复制";
    setTimeout(() => { copyButton.textContent = old; }, 1200);
    return;
  }
  // 生成草稿按钮
  if (event.target.closest("#generateDraftBtn")) {
    await handleGenerateDraft();
    return;
  }
  // 通过，创建飞书草稿
  if (event.target.closest("#approveDraftBtn")) {
    await handleApproveDraft();
    return;
  }
  // 复制草稿文本
  if (event.target.closest("#copyDraftBtn")) {
    const body = $("#draftBody")?.textContent || "";
    await navigator.clipboard.writeText(body);
    const btn = $("#copyDraftBtn");
    btn.textContent = "已复制";
    setTimeout(() => { btn.textContent = "复制文本"; }, 1200);
    return;
  }
  // 关闭预览
  if (event.target.closest("#cancelDraftBtn")) {
    const preview = $("#draftPreview");
    if (preview) preview.hidden = true;
    return;
  }
});

// ─── 草稿生成 ─────────────────────────────────────────────────────────────────
let currentDraftData = null;

async function handleGenerateDraft() {
  const btn = $("#generateDraftBtn");
  const input = $("#composeInput");
  const preview = $("#draftPreview");
  if (!btn || !input || !preview) return;

  const userPrompt = input.value.trim();
  if (!userPrompt) {
    input.focus();
    input.placeholder = "请先输入你的回复意图...";
    return;
  }

  const recordId = btn.dataset.recordId;
  const agent = btn.dataset.agent || "claude";
  btn.disabled = true;
  btn.textContent = "生成中...";
  preview.hidden = true;

  try {
    const res = await fetch("/api/draft-reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recordId, userPrompt, agent })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "生成失败");

    currentDraftData = data;
    showDraftPreview(data);
  } catch (error) {
    const preview = $("#draftPreview");
    if (preview) {
      preview.hidden = false;
      const body = $("#draftBody");
      if (body) body.textContent = `生成失败：${error.message}`;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "生成回复草稿";
  }
}

function showDraftPreview(data) {
  const preview = $("#draftPreview");
  const metaEl = $("#draftMeta");
  const bodyEl = $("#draftBody");
  const feishuLink = $("#draftFeishuLink");
  if (!preview || !bodyEl) return;

  if (metaEl) {
    metaEl.innerHTML = `
      <span class="draft-meta-item"><b>收件人</b>${escapeHtml(data.toEmail || "")}</span>
      <span class="draft-meta-item"><b>主题</b>${escapeHtml(data.subject || "")}</span>
      ${data.warning ? `<span class="draft-warning">${escapeHtml(data.warning)}</span>` : ""}
    `;
  }

  if (bodyEl) {
    bodyEl.textContent = data.draft || "（草稿为空）";
  }

  if (feishuLink) feishuLink.hidden = true;

  preview.hidden = false;
  preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function handleApproveDraft() {
  if (!currentDraftData) return;
  const btn = $("#approveDraftBtn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "创建中...";

  try {
    const res = await fetch("/api/feishu-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        emailBody: currentDraftData.draft,
        subject: currentDraftData.subject,
        toEmail: currentDraftData.toEmail,
        lastMessageId: currentDraftData.lastMessageId
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "创建草稿失败");

    const feishuLink = $("#draftFeishuLink");
    if (feishuLink) {
      feishuLink.hidden = false;
      feishuLink.innerHTML = `
        <span class="feishu-link-label">草稿已创建</span>
        <a class="feishu-link-btn" href="${escapeHtml(data.feishuMailUrl || "#")}" target="_blank" rel="noreferrer">
          在飞书邮件中查看草稿 →
        </a>
      `;
    }
    btn.textContent = "✓ 已创建";
  } catch (error) {
    const feishuLink = $("#draftFeishuLink");
    if (feishuLink) {
      feishuLink.hidden = false;
      feishuLink.innerHTML = `<span class="draft-warning">${escapeHtml(error.message)}</span>`;
    }
    btn.disabled = false;
    btn.textContent = "通过，创建飞书草稿";
  }
}

els.refreshBtn.addEventListener("click", async () => {
  els.refreshBtn.disabled = true;
  try {
    await loadRecords(true);
  } catch (error) {
    els.loadingState.hidden = false;
    els.loadingState.textContent = error.message;
  } finally {
    els.refreshBtn.disabled = false;
  }
});

loadRecords().catch((error) => {
  els.loadingState.hidden = false;
  els.loadingState.textContent = error.message;
});
