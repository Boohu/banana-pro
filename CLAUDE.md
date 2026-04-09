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
- `backend/` — Go 后端（Web 和桌面共用）

## 关键注意事项

- `desktop/src/services/api.ts` 有 Tauri 动态端口检测，和 `frontend/src/services/api.ts` 不同，不要覆盖
- 修改 `frontend/src/` 后需要手动同步到 `desktop/src/`（除 api.ts 外）
- Web 端连 Docker 后端（8090），桌面端连 Tauri sidecar（动态端口）
- 桌面端下载文件必须用 `invoke('download_file_to_path')`，不能用 `window.location.href`（会被 CORS 拦截）
- 模板数据在 `frontend/src/data/communityTemplates.ts`，来源 YouMind 社区 129 个 prompt
