# 筋斗云AI

[![GitHub stars](https://img.shields.io/github/stars/Boohu/banana-pro?style=flat-square)](https://github.com/Boohu/banana-pro/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/Boohu/banana-pro/blob/main/LICENSE)
![React](https://img.shields.io/badge/React-18-blue.svg?style=flat-square)
![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131.svg?style=flat-square)
![Go](https://img.shields.io/badge/Go-1.21-00ADD8.svg?style=flat-square)

AI 驱动的图片生成与批量处理工具，支持 Web 端与桌面端。基于 [Nano Banana Pro Web](https://github.com/ShellMonster/Nano_Banana_Pro_Web) 二次开发。

<p align="center">
  <img src="assets/preview1.png" alt="筋斗云AI 预览" width="800">
</p>

---

## 核心特性

- **文生图 / 图生图** — 集成 Gemini 与 OpenAI 标准接口，支持 1K~4K 超清生成
- **批量处理** — 一键批量处理上百张图片，后台自动排队
- **模板市场** — 129+ 社区模板，分类筛选、一键复用
- **历史管理** — 本地数据库持久化，文件夹归档，关键字搜索
- **双端部署** — 桌面端（Tauri 2.0）+ Web 端（Docker），共用 Go 后端

---

## 技术架构

```
frontend/src/     Web 端前端（React + shadcn/ui + Tailwind）
desktop/src/      桌面端前端（Tauri 专属 API）
desktop/src-tauri/ Tauri Rust 层（sidecar、剪贴板、文件操作）
backend/          Go 后端（Web 和桌面共用）
```

- **前端**: React 18 + Zustand + Tailwind CSS + shadcn/ui
- **桌面容器**: Tauri 2.0（Rust）
- **后端**: Go + Gin + SQLite + Google GenAI SDK
- **部署**: Docker Compose（前端 Nginx + 后端 Go）

---

## 快速开始

### Docker 部署（Web 版）

```bash
# 1. 配置环境变量
cp .env.example .env
nano .env  # 填入 API Key

# 2. 启动
docker compose -p banana-pro up -d

# 3. 访问 http://localhost:8090
```

### 本地开发

```bash
# 后端
cd backend && go run cmd/server/main.go

# Web 前端
cd frontend && npm install && npm run dev

# 桌面端
cd desktop && npm install && npm run tauri dev
```

环境要求：Go 1.21+ / Node.js 18+ / Rust 1.75+（桌面端）

---

## macOS 安装提示

下载后如遇 Gatekeeper 拦截，终端执行：

```bash
sudo xattr -r -d com.apple.quarantine "/Applications/筋斗云AI.app"
```

---

## 致谢

- 基于 [Nano Banana Pro Web](https://github.com/ShellMonster/Nano_Banana_Pro_Web) 二次开发
- 模板来源 [awesome-nanobananapro-prompts](https://github.com/xianyu110/awesome-nanobananapro-prompts)
- JSON 提示词优化参考 [fofr](https://gist.github.com/fofr/eec0dae326243321c645aceba28c6119)

## 开源协议

[MIT License](LICENSE)
