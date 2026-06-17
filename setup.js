#!/usr/bin/env node
// easyol KOL 控制台 · 交互式安装向导
// 零依赖：仅用 Node 内置模块。运行：npm run setup
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ENV_PATH = join(__dirname, ".env");

const rl = createInterface({ input, output });

const C = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`
};

// 检查某个命令是否可用（ENOENT 表示未安装）
function hasBin(bin) {
  const r = spawnSync(bin, ["--version"], { stdio: "ignore" });
  return !(r.error && r.error.code === "ENOENT");
}

// 带默认值的提问；回车采用默认值
async function ask(question, def = "") {
  const suffix = def ? C.dim(` [${def}]`) : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || def;
}

async function askYesNo(question, defYes = true) {
  const hint = defYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} ${C.dim(`(${hint})`)} `)).trim().toLowerCase();
  if (!answer) return defYes;
  return answer === "y" || answer === "yes";
}

// 知识库 wiki 链接 → 用 lark-cli 解析出 base token（obj_token）
function resolveWikiBase(urlOrToken) {
  try {
    const r = spawnSync(
      "lark-cli",
      ["wiki", "+node-get", "--node-token", urlOrToken, "--as", "user", "--format", "json"],
      { encoding: "utf8" }
    );
    if (r.error || r.status !== 0) return "";
    const text = String(r.stdout || "");
    const start = text.search(/[[{]/);
    if (start === -1) return "";
    const node = JSON.parse(text.slice(start));
    return node && node.obj_token ? node.obj_token : "";
  } catch {
    return "";
  }
}

// 从飞书多维表格 URL 里尽量解析出 base token / table / view
function parseFeishuUrl(raw) {
  const out = { baseToken: "", tableId: "", viewId: "" };
  if (!raw) return out;
  try {
    const u = new URL(raw);
    out.tableId = u.searchParams.get("table") || "";
    out.viewId = u.searchParams.get("view") || "";
    // 形如 .../base/<baseToken> 的常规多维表格链接
    const m = u.pathname.match(/\/base\/([A-Za-z0-9]+)/);
    if (m) out.baseToken = m[1];
  } catch {
    // 不是合法 URL 就忽略，让用户手动填
  }
  return out;
}

// 读取已有 .env 作为默认值（重复运行 setup 时不丢配置）
function loadExistingEnv() {
  const env = {};
  if (!existsSync(ENV_PATH)) return env;
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim()] = v;
  }
  return env;
}

function envLine(key, value) {
  // 值含空格/特殊字符时加引号
  const needsQuote = /[\s#"']/.test(value);
  return `${key}=${needsQuote ? JSON.stringify(value) : value}`;
}

async function main() {
  console.log("\n" + C.bold("easyol KOL 控制台 · 安装向导"));
  console.log(C.dim("会引导你检查依赖、确认飞书登录，并生成 .env 配置。\n"));

  // 1) 依赖检查
  console.log(C.bold("① 检查依赖"));
  const larkOk = hasBin("lark-cli");
  console.log(`  lark-cli: ${larkOk ? C.green("已安装") : C.red("未找到")}`);
  if (!larkOk) {
    console.log(C.yellow("  → 必须先安装 lark-cli 才能读写飞书表格和邮件。安装后重新运行 npm run setup。\n"));
  }

  const existing = loadExistingEnv();
  const codexBinDefault = existing.CODEX_BIN || "codex";
  const claudeBinDefault = existing.CLAUDE_BIN || "claude";
  const claudeOk = hasBin(claudeBinDefault);
  const codexOk = hasBin(codexBinDefault);
  console.log(`  claude: ${claudeOk ? C.green("已安装") : C.dim("未找到")}`);
  console.log(`  codex:  ${codexOk ? C.green("已安装") : C.dim("未找到")}`);
  if (!claudeOk && !codexOk) {
    console.log(C.yellow("  → claude 和 codex 至少需要装一个，否则无法生成邮件草稿/分析。"));
  }
  console.log("");

  // 2) 飞书登录
  console.log(C.bold("② 飞书登录"));
  console.log(C.dim("  这套系统用你本机 lark-cli 的登录身份访问飞书（--as user）。"));
  const loggedIn = await askYesNo("  你是否已经用 lark-cli 登录了自己的飞书账号？", true);
  if (!loggedIn) {
    console.log(C.yellow("\n  请在另一个终端运行下面的命令完成登录（会弹出授权链接/二维码）："));
    console.log(
      C.cyan(
        '    lark-cli auth login --scope "bitable:app mail:user_mailbox:readonly mail:user_mailbox.message:readonly mail:user_mailbox.message:modify wiki:node:retrieve"'
      )
    );
    console.log(C.dim("  （如提示缺少某个 scope，按报错里的 missing_scope 再 login 一次即可，权限会累积。）"));
    console.log(C.dim("  登录完成后重新运行 npm run setup。\n"));
  } else {
    console.log("");
  }

  // 3) 采集配置
  console.log(C.bold("③ 填写你的飞书多维表格"));
  console.log(C.dim("  可直接粘贴浏览器里打开表格的完整 URL，我会尽量自动解析。"));
  const pastedUrl = await ask("  飞书表格 URL", existing.FEISHU_TABLE_URL || "");
  const parsed = parseFeishuUrl(pastedUrl);
  // 知识库链接里没有 base token，尝试用 lark-cli 解析
  if (!parsed.baseToken && pastedUrl && /\/wiki\//.test(pastedUrl) && larkOk) {
    process.stdout.write(C.dim("  检测到知识库链接，正在用 lark-cli 解析 base token…\n"));
    const resolved = resolveWikiBase(pastedUrl);
    if (resolved) {
      parsed.baseToken = resolved;
      console.log(C.green("  ✓ 已解析 base token：" + resolved));
    } else {
      console.log(C.yellow("  未能自动解析（可能未登录或缺 wiki:node:retrieve 权限），请手动填 base token。"));
    }
  }

  const baseToken = await ask("  LARK_BASE_TOKEN（base token）", parsed.baseToken || existing.LARK_BASE_TOKEN || "");
  const tableId = await ask("  LARK_TABLE_ID（table id）", parsed.tableId || existing.LARK_TABLE_ID || "");
  const viewId = await ask("  LARK_VIEW_ID（view id）", parsed.viewId || existing.LARK_VIEW_ID || "");
  const feishuUrl = await ask("  FEISHU_TABLE_URL（打开表格用的链接）", pastedUrl || existing.FEISHU_TABLE_URL || "");

  console.log("\n" + C.bold("④ 你的身份与服务"));
  const ownerEmail = await ask(
    "  OWNER_EMAIL（你的飞书邮箱，用于区分邮件我方/对方，可逗号分隔多个）",
    existing.OWNER_EMAIL || ""
  );

  // 团队品牌：用于邮件主题与 AI 提示词
  console.log(C.dim("  团队品牌（写进邮件主题与 AI 提示词）：1) Bloome   2) Renoise"));
  const brandDefault = existing.BRAND || "Bloome";
  const brandInput = await ask("  选择 1/2，或直接输入自定义名称", brandDefault);
  const brand = brandInput === "1" ? "Bloome" : brandInput === "2" ? "Renoise" : brandInput;

  const port = await ask("  PORT（本地端口）", existing.PORT || "4173");

  // AI 可执行路径：找到就不再问，没找到给机会手填
  let codexBin = existing.CODEX_BIN || "";
  let claudeBin = existing.CLAUDE_BIN || "";
  if (!codexOk) {
    const v = await ask("  CODEX_BIN（codex 可执行路径，未装可留空）", codexBin);
    codexBin = v;
  }
  if (!claudeOk) {
    const v = await ask("  CLAUDE_BIN（claude 可执行路径，未装可留空）", claudeBin);
    claudeBin = v;
  }

  // 4) 写 .env
  if (existsSync(ENV_PATH)) {
    const ow = await askYesNo("\n  已存在 .env，是否覆盖？", false);
    if (!ow) {
      console.log(C.yellow("  已取消，未修改 .env。"));
      rl.close();
      return;
    }
  }

  const lines = [
    "# easyol KOL 控制台配置（由 npm run setup 生成）",
    "# 每个用户应使用自己的飞书表格与邮箱，请勿提交本文件。",
    "",
    "# —— 飞书多维表格（每个用户各自的表） ——",
    envLine("LARK_BASE_TOKEN", baseToken),
    envLine("LARK_TABLE_ID", tableId),
    envLine("LARK_VIEW_ID", viewId),
    envLine("FEISHU_TABLE_URL", feishuUrl),
    "",
    "# —— 你的身份 ——",
    envLine("OWNER_EMAIL", ownerEmail),
    "",
    "# —— 团队品牌（邮件主题 / AI 提示词） ——",
    envLine("BRAND", brand),
    "",
    "# —— 服务 ——",
    envLine("PORT", String(port))
  ];
  if (codexBin) lines.push("", "# —— 可选：AI 可执行路径 ——", envLine("CODEX_BIN", codexBin));
  if (claudeBin) {
    if (!codexBin) lines.push("", "# —— 可选：AI 可执行路径 ——");
    lines.push(envLine("CLAUDE_BIN", claudeBin));
  }
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf8");

  console.log("\n" + C.green("✓ 已写入 .env"));

  // 缺项提醒
  const missing = [];
  if (!baseToken) missing.push("LARK_BASE_TOKEN");
  if (!tableId) missing.push("LARK_TABLE_ID");
  if (!viewId) missing.push("LARK_VIEW_ID");
  if (!ownerEmail) missing.push("OWNER_EMAIL");
  if (missing.length) {
    console.log(C.yellow(`  注意：以下必填项还为空，启动会被拦截：${missing.join(", ")}`));
  }

  console.log("\n" + C.bold("下一步：") + " 运行 " + C.cyan("npm start") + "，浏览器打开 " + C.cyan(`http://localhost:${port}`) + "\n");
  rl.close();
}

main().catch((err) => {
  console.error(C.red("安装向导出错：") + err.message);
  rl.close();
  process.exit(1);
});
