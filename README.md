# easyol · KOL 联动管理台

基于飞书多维表格 + 飞书邮件的 KOL 联动管理台。每个用户在**自己的电脑本地运行**，用**自己的飞书账号**对着**自己的多维表格**工作，浏览器访问 `localhost` 使用。

工作原理：本地 Node 服务通过本机的 `lark-cli`（以 `--as user` 身份）读写飞书表格与邮件，并调用本机的 `claude` 或 `codex` 生成邮件草稿/账号分析。**没有中心服务器，也不收集任何人的凭证**——你的飞书登录只存在你自己机器的 lark-cli 里。

---

## 一、前置条件（每个用户各装一次）

1. **Node.js** ≥ 18（建议 20+）。
2. **lark-cli**：用于访问飞书表格和邮件。安装后需要登录你自己的飞书账号（见下文）。
3. **claude 或 codex（二选一即可，装了都可用）**：用于生成邮件草稿和账号分析。
   - 默认从 PATH 找 `claude` / `codex`；装在非标准位置可在 `.env` 里用 `CLAUDE_BIN` / `CODEX_BIN` 指定绝对路径。

---

## 二、首次安装

```bash
# 1. 拉取代码
git clone <仓库地址> easyol && cd easyol

# 2. 登录你自己的飞书（会弹出授权链接/二维码，按提示完成）
lark-cli auth login --scope "bitable:app drive:drive mail:user_mailbox.message mail:user_mailbox.message:send"
#   若运行中提示缺少某个 scope，按报错里的 missing_scope 再 login 一次即可，权限会累积。

# 3. 启动
npm start
```

**配置有两种方式，任选其一：**

- **网页配置（推荐）**：直接 `npm start`，浏览器打开提示的地址（默认 <http://localhost:4173>）。未配置时会自动显示**配置向导页**，填好表格 token / 邮箱 / 品牌后点“保存并继续”，验证通过即进入主界面（无需重启）。
- **命令行配置**：运行 `npm run setup`，按提示交互式生成 `.env`，再 `npm start`。

> 本项目零 npm 依赖，无需 `npm install`。服务只监听 `127.0.0.1`（本机），配置仅写入本机 `.env`。

---

## 三、配置说明

`npm run setup` 会生成 `.env`（也可手动复制 `.env.example` 为 `.env` 填写）。各项含义：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `LARK_BASE_TOKEN` | ✅ | 多维表格 base token |
| `LARK_TABLE_ID` | ✅ | 数据表 table id |
| `LARK_VIEW_ID` | ✅ | 视图 view id |
| `FEISHU_TABLE_URL` | 建议 | “打开飞书表格”按钮跳转的链接 |
| `OWNER_EMAIL` | ✅ | 你的飞书邮箱，用于区分邮件里的“我方”和“KOL”，可逗号分隔多个 |
| `BRAND` | 否 | 团队品牌名，写进邮件主题和 AI 提示词，可选 `Bloome` / `Renoise`，默认 `Bloome` |
| `PORT` | 否 | 本地端口，默认 `4173` |
| `CLAUDE_BIN` / `CODEX_BIN` | 否 | AI 可执行路径，默认从 PATH 找 |
| `FEISHU_MAIL_URL` | 否 | 创建邮件草稿后“在飞书中查看”的回退链接 |

**如何取 base token / table / view**：在浏览器打开你的多维表格，复制地址栏 URL。
- 常规多维表格链接形如 `https://<域名>/base/<这一段就是 base token>?table=<table id>&view=<view id>`。
- `setup` 支持直接粘贴这条 URL 自动解析；解析不到的字段（如知识库内嵌的表）再手动补填即可。

---

## 四、表格字段要求

系统按**固定的中文字段名**读取表格（见 `server.js` 里的 `FIELD_ALIASES`）。**建议从团队提供的模板表复制一份**，保证字段名一致，否则数据会读不出来。需要的字段：

`主页URL`、`频道ID`、`标签`、`联系方式`、`负责人`、`重复`、`资源来源`、`语种`、`合作形式`、`联系状态`、`国家`、`备注（报价、合作形式等）`、`受众截图`、`状态更新时间`、`添加时间`。

---

## 五、常用快捷键

- `⌘F` / `Ctrl+F`：聚焦搜索框。
- 搜索邮箱等命中唯一结果时，会自动打开该 KOL。

---

## 六、故障排查

- **启动报“缺少必要配置”**：还没配置或 `.env` 缺项，运行 `npm run setup`。
- **读表/邮件报授权错误（missing scope / authorization）**：补登录 `lark-cli auth login --scope "<缺的 scope>"` 后刷新页面。
- **页面没数据 / 字段为空**：八成是表格字段名和上面“字段要求”不一致，用模板表复制。
- **生成草稿/分析报“没有找到 claude/codex 命令”**：未安装对应工具，或路径不对——装好后在 `.env` 设置 `CLAUDE_BIN` / `CODEX_BIN`。
- **多个用户**：各自在自己机器上重复“安装”步骤，用各自的飞书账号和表，互不影响。
