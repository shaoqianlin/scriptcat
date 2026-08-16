# 🐱 爆款猫

> 流量密码，喵一眼就懂 —— 拆解爆款短视频脚本，帮你理解它为什么火。

一个移动端 H5 应用。粘贴一条爆款脚本，AI 拆出它为什么火——开头钩子怎么抓人、每段是什么结构、情绪怎么递进、用了什么爆款公式；多拆几条同主题的，还能归纳出共性的流量密码，让你一眼看懂爆款的底层逻辑。

## ✨ 功能

- 🔍 **AI 拆解** — 粘贴脚本 + 标题 + 文案 + 标签，拆解开头钩子、节拍结构、情绪曲线、爆款公式、改写方向
- 🧬 **批量归纳** — 多条同主题拆解后，一键归纳共性规律
- 👤 **用户登录 / 注册** — 账号体系，历史记录云端保存
- 📋 **历史记录** — 每人最多保留 20 条，未登录时存本地浏览器

## 🚀 快速开始

### 环境要求

- Node.js ≥ 22.5（推荐 24，项目使用内置 `node:sqlite` 模块）

### 1. 安装依赖

```bash
cd mvp
npm install
```

### 2. 配置环境变量

复制模板并填入你的 DeepSeek API Key：

```bash
cp .env.example .env
```

编辑 `.env`：

```
DEEPSEEK_API_KEY=你的key
```

### 3. 启动

```bash
node server.js
# 或 npm start
```

浏览器打开 http://localhost:3000

手机访问：同一局域网内用 `http://<电脑IP>:3000`

## 🔑 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek API Key |
| `API_URL` | 否 | 默认 `https://api.deepseek.com/v1/chat/completions` |
| `MODEL` | 否 | 默认 `deepseek-chat` |
| `PORT` | 否 | 默认 `3000` |

## 🛠 技术栈

- Node.js + Express
- SQLite（内置 `node:sqlite`，数据存本地 `data.db`）
- bcryptjs（密码加密）
- DeepSeek API（AI 分析）

## 📁 目录结构

```
mvp/
├── index.html      # 前端（单文件 H5）
├── server.js       # 后端 API
├── package.json
└── .env.example    # 环境变量模板
```

## ⚠️ 注意

- `.env`、`data.db` 等敏感文件已被 `.gitignore` 排除，**请勿提交**
- 本项目仅本地运行，未部署到云端服务器
