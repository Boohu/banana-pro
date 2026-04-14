# 筋斗云AI（基于 Nano Banana Pro Web 二开）

## 沟通与工作方式

- 每次回复时都叫我【猫哥】
- 这是未发布项目，不考虑向旧版兼容
- 不准猜测，不确定就查文档或询问，自己动手验证（读配置/日志、curl 调 API、写脚本复现），用实际数据定位断在哪一环，确认根因后再改代码

## 语言规范

- **对话和回复**：使用简体中文
- **代码注释**：使用中文，便于理解
- **文档说明**：使用简体中文
- **代码标识符**：变量名、函数名等使用英文（遵循编程规范）

## 项目结构

- `frontend/src/` — Web 端前端（暗色主题，shadcn/ui + Tailwind）
- `desktop/src/` — 桌面端前端（从 frontend 复制 + Tauri 专属 api.ts）
- `desktop/src-old/` — 桌面端旧前端（备份）
- `desktop/src-tauri/` — Tauri Rust 层（sidecar 管理、剪贴板、文件操作）
- `backend/` — Go 后端（Web 和桌面共用，图片生成 sidecar）

## 认证服务（独立仓库）

- **仓库**：https://github.com/Boohu/auth-server
- **服务器**：auth.3ux.cn（宝塔面板管理）
- **技术栈**：Go + Gin + GORM + MySQL
- **功能**：用户注册/登录、JWT 鉴权、多应用授权、微信/支付宝支付、自动更新版本管理、管理后台
- **前端对接文件**：`frontend/src/services/authApi.ts`（AUTH_URL 默认 `https://auth.3ux.cn/api`）
- **模板数据**：远程加载自 `https://auth.3ux.cn/static/templates.json`，图片托管在七牛 CDN（pic.3ux.cn）
- **自动部署**：push 到 main 后 GitHub Actions 自动编译部署到服务器
- **管理后台**：https://auth.3ux.cn/admin

## 关键注意事项

- `desktop/src/services/api.ts` 有 Tauri 动态端口检测，和 `frontend/src/services/api.ts` 不同，不要覆盖
- 修改 `frontend/src/` 后需要手动同步到 `desktop/src/`（除 api.ts 外）
- Web 端连 Docker 后端（8090），桌面端连 Tauri sidecar（动态端口）
- 桌面端下载文件必须用 `invoke('download_file_to_path')`，不能用 `window.location.href`（会被 CORS 拦截）
- 模板数据已改为远程加载（`auth.3ux.cn/static/templates.json`），本地 `communityTemplates.ts` 作为备份
- 桌面端发版：`git tag vX.Y.Z && git push origin vX.Y.Z`，CI 自动构建三平台 + 上传到更新服务器
- CORS 需同时放行 `tauri://localhost`（macOS）和 `http://tauri.localhost`（Windows）
