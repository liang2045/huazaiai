# iMade

> iMade（iMade）· AI 节点画布工作流工具 · Web + Electron 桌面端｜v3.1.9
>
> 当前界面品牌：iMade；当前安装包：`iMade-Setup-3.1.9.exe`。

一个面向 AI 创作的 **节点式画布**：拖拽节点、连线编排、生成图像 / 视频 / 音频、调用 LLM、串接 RunningHub 工作流，叠加批量执行、智能对齐、打组、双主题与终端日志。Web 浏览器即可使用，亦可一键打包为 Windows 桌面端（NSIS 安装包）。

![status](https://img.shields.io/badge/version-v3.1.9-brightgreen) ![node](https://img.shields.io/badge/node-%E2%89%A518-blue) ![react](https://img.shields.io/badge/react-19-61dafb) ![electron](https://img.shields.io/badge/electron-33-47848f) ![license](https://img.shields.io/badge/license-MIT-yellow)

---

## ✨ 功能亮点

- 🎨 **27 个业务节点**，覆盖文本 / 图像 / 视频 / 音频 / LLM / RunningHub / 工具 / 辅助 / 工具箱 / 输出预览 / 上传素材
- 🧩 **xyflow 12** 画布引擎：缩放、平移、连线、迷你地图、控制条、SPA 兜底
- 🔑 **四套独立 API Key 隔离**：模型服务 / RunningHub / RH 钱包应用 / LLM —— 普通前端接口仅返回脱敏值，明文仅供后端代理本地读取
- 🚀 **一键批量运行**：Kahn 拓扑排序串行触发可执行节点，进度可视化，支持中断
- 🧲 **智能对齐辅助线 + snap-to-grid**：拖动时检测同列 / 同行 / 居中对齐并弱吸附
- 📦 **GroupBox 打组**：框选 ≥2 节点一键套色框容器，可拖拽联动、整体执行、12 色调色板
- 🖱️ **右键画布快速添加节点**：菜单列出 7 个高频节点（upload / text / image / video / seedance / audio / llm）
- 🎯 **框选自动菜单**：≥2 节点框选后自动弹出操作面板（组执行 / 复制 / 快复制 / 删除 / 打组）
- ⏪ **Undo / Redo / 复制粘贴 / 导入导出 / 工作流模板** 完整画布交互
- 🌗 **双主题双模式**：科技风（默认） + 像素糖果风，浅色 / 深色 4 种组合任意切换
- 🖥️ **终端日志面板**：底部抽屉式实时日志，对齐主项目 logBus 协议
- 🛡️ **防空数据覆盖**：双层防护（前端 + 后端）保护已保存画布数据
- 📦 **一键 Electron 打包**：bytenode + T8ENC1 加密后端 + NSIS 安装包，开箱即用桌面端

---

## 🚀 快速开始

### 环境要求

- **Node.js ≥ 18**
- Windows / macOS / Linux 浏览器（推荐 Chromium 内核）
- （可选）Windows 系统用于 Electron 桌面端打包

### 安装

```bash
git clone https://github.com/imade-ai/imade.git
cd imade
npm install
cd backend && npm install && cd ..
```

### 启动开发模式

```bash
npm run dev
```

`concurrently` 会同时拉起：

- 后端：<http://127.0.0.1:18766>
- 前端：<http://127.0.0.1:11422>

浏览器自动打开前端地址即可使用。Windows 下也可以双击 `start-dev.bat` 一键启动。

### 配置 API Key

首次进入点击右上角 ⚙️ 打开设置弹窗，按需填入：

| Key | 用途 | 默认 BaseUrl |
|---|---|---|
| 模型服务 API Key | image / video / audio | `https://ai.t8star.org` |
| LLM 独立 API Key | llm / vision（额度隔离） | OpenAI 兼容协议任意上游 |
| RunningHub API Key | RunningHub 个人工作流 | `https://www.runninghub.cn` |
| RH 钱包应用 APIKEY | RH 企业级共享 APIKEY（钱包应用专用） | `https://www.runninghub.cn` |

Key 保存到 `data/settings.json`；普通前端设置接口仅返回 `****xxxx` 脱敏值，明文仅供后端代理在本地进程内读取。

> **不需要全部配置**：只填需要使用的那一类即可，其它节点会在运行时友好提示「未配置 XXX API Key」。

---

## 🖥️ Electron 桌面端打包

```bash
# 一键出 Windows NSIS 安装包
npm run dist
```

产物：`dist_electron/iMade-Setup-3.1.9.exe`

打包链路：`vite build` → `bytenode + T8ENC1` 加密后端为 `.t8c` 字节码 → `electron-builder --win --x64` 出 NSIS 安装包 → `_post_build.cjs` 自动校验 7 个 .t8c + 前端 dist 完整性。

详细 SOP 与三处历史踩坑修复记录见 [`skill.md` §47](./skill.md)。

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 19 · TypeScript 5 · Vite 6 |
| 样式 | Tailwind CSS 3 · CSS Modules · 双主题（科技风 / 像素糖果风） |
| 画布引擎 | @xyflow/react 12 · zustand 5 · lucide-react |
| 后端 | Node.js · Express · sharp（图像处理） · multer（上传） |
| 桌面端 | Electron 33 · electron-builder 25 · bytenode 1.5 · T8ENC1（自研 AES-256-CBC 二次加密） |
| AI 上游 | 模型服务（图像/视频/Suno）· RunningHub · 任意 OpenAI 兼容 LLM |

---

## 📁 目录结构

```
imade/
├── backend/                 # Express 后端（端口 18766）
│   └── src/
│       ├── server.js        # 入口，挂载 5 类路由 + SPA 兜底
│       ├── config.js        # 端口 / 目录 / 上游 baseUrl
│       └── routes/          # canvas / settings / files / imageOps / proxy
├── src/                     # 前端
│   ├── App.tsx              # 三栏布局 + 状态栏
│   ├── components/
│   │   ├── Canvas.tsx       # 画布主体 + 批量运行 + 对齐辅助 + GroupBox
│   │   ├── CanvasToolbar.tsx
│   │   ├── TerminalPanel.tsx
│   │   ├── CanvasManager.tsx
│   │   ├── Sidebar.tsx
│   │   ├── ApiSettings.tsx
│   │   └── nodes/           # 27 个节点组件
│   ├── stores/              # canvas / apiKeys / theme / runBus / logs
│   ├── hooks/               # useCanvasHistory / useRunTrigger
│   ├── services/            # api / generation / imageOps
│   ├── config/              # nodeRegistry / canvasTemplates / portTypes
│   ├── providers/           # 模型注册表
│   ├── utils/               # topologicalSort / wheelBlock
│   └── types/canvas.ts
├── electron/                # Electron 主进程（CommonJS）
│   ├── main.cjs             # 主进程 + 后端拉起 + IPC
│   ├── loader.cjs           # bytenode .jsc loader 复刻 + MODULE_NOT_FOUND 兜底
│   ├── encrypt.cjs          # T8ENC1 加密脚本
│   ├── preload.cjs          # IPC 桥接
│   └── _post_build.cjs      # 打包后置校验
├── features.json            # 节点防丢失锁 + 接口快照 + 打包 SOP
├── skill.md                 # 项目能力 / 接口 / 文件用途 / 打包 SOP 速查
├── vite.config.ts           # 前端 11422 + /api → 18766 代理
├── start-dev.bat            # Windows 一键启动
└── package.json
```

详细字段见 [skill.md](./skill.md)。

---

## 🎛️ 画布快捷键

| 快捷键 | 作用 |
|---|---|
| `Ctrl + Z` | 撤销 |
| `Ctrl + Shift + Z` / `Ctrl + Y` | 重做 |
| `Ctrl + C` / `Ctrl + V` / `Ctrl + D` | 复制 / 粘贴 / 快速复制 |
| `Delete` / `Backspace` | 删除选中节点或连线 |
| `Ctrl + A` | 全选节点 |
| `空格 + 拖拽` | 平移画布 |
| `滚轮 / 触控板` | 缩放画布 |

工具栏图标：▶ 批量运行 · 🧲 网格吸附 · ↶↷ 历史 · ⧉ 复制 · 📋 粘贴 · 🗑️ 删除 · ⬆️ 导入 · ⬇️ 导出 · ✨ 模板 · ❓ 帮助

---

## ⚙️ 批量执行（拓扑串行）

工具栏 ▶ 按钮一键运行画布上所有 **可执行节点**：

1. `topologicalSort()` 在「仅含可执行节点」的子图上做 Kahn 排序
2. 串行 `triggerRun(id)` → 等待运行总线 `lastDone.id === id` 推进
3. 进度徽标 `done/total` 实时显示，再次点击（■）中断

可执行节点（16 类）：image / edit / multi-angle-3d / panorama-720 / penguin-portrait / video / seedance / audio / llm / runninghub / resize / upscale / grid-crop / remove-bg / combine / frame-extractor。

---

## 🧲 节点对齐辅助

- **snap-to-grid**：xyflow 原生 20×20 网格吸附
- **智能辅助线**：拖动时检测每对节点的 6 条边（左/中/右、上/中/下），距离 < 6px 触发：
  - SVG 橙色虚线在世界坐标系（随视口缩放）渲染
  - 自动取差值最小者做弱吸附

工具栏「磁铁」按钮统一控制开关。

---

## 🛠️ 后端接口速览

完整接口表见 [skill.md §3](./skill.md#3-后端接口http1270018766)。

| 分组 | 主要路径 |
|---|---|
| 健康 | `GET /api/status` |
| 画布 | `GET/POST /api/canvas`、`GET/PUT/DELETE /api/canvas/:id`、`PATCH /api/canvas/:id/name` |
| 设置 | `GET/POST /api/settings` |
| 文件 | `POST /api/files/upload`、`GET /api/files/list`、`POST /api/files/upload-base64` |
| 图像处理 | `/api/image/{resize,upscale,grid-crop,combine,remove-bg}` |
| 上游代理 | `/api/proxy/image`、`/api/proxy/llm`、`/api/proxy/video/{submit,query}`、`/api/proxy/audio/{submit,query}`、`/api/proxy/runninghub/{submit,query,app-info}` |

代理层会 **自动转存** 上游图像 / 视频 / 音频到 `output/`，前端永远拿到稳定的本地 `/files/output/*` URL。

---

## 📦 构建 / 部署

```powershell
npm run type-check    # tsc --noEmit
npm run build         # tsc -b && vite build
npm run preview       # 本地预览构建产物
```

后端为纯 Node 服务，部署时直接 `node backend/src/server.js` 即可，注意：

- `data/` 持久化设置和画布
- `input/ output/ thumbnails/` 持久化用户素材与生成产物（首次自动创建）

---

## 📋 节点清单（27 个，可见 + 隐藏）

| 分组 | 节点 |
|---|---|
| 素材资源 (2) | upload（上传素材） · output（输出素材终端预览） |
| 核心 (6) | text · image · video · seedance · audio · llm |
| RunningHub (3) | runninghub · runninghub-wallet（RH 钱包应用） · rh-config（隐藏） |
| 特殊 (5, 隐藏) | multi-angle-3d · panorama-720 · penguin-portrait · portrait-metadata · storyboard-grid |
| 工具 (9) | drawing-board · browser · image-compare · frame-extractor · resize · combine · remove-bg · upscale · grid-crop |
| 辅助 (5) | edit（隐藏） · idea · bp · relay · video-output（隐藏） |
| 工具箱 (2) | cinematic · video-motion |

> 任何节点的删减都需在 [features.json](./features.json) 中说明并同步 [skill.md](./skill.md)。

---

## 🤝 贡献

欢迎 Issue / PR ！

- 提交 Issue 前请先搜索是否已存在；附上复现步骤、期望与实际行为、截图（如有）
- 提交 PR 前请保证：
  - `npm run type-check` 通过
  - `npm run build` 通过
  - 涉及节点变动需同步 [features.json](./features.json) 与 [skill.md](./skill.md)
  - Commit 信息使用 [Conventional Commits](https://www.conventionalcommits.org/) 风格（`feat:` `fix:` `chore:` `docs:` 等）

---

## 📜 License

MIT License © T8mars

本项目以 MIT 协议开源。允许在保留版权与许可声明的前提下自由使用、复制、修改、合并、出版、分发、再授权及销售本软件副本。详见 [LICENSE](./LICENSE)（如未单独提供，请参考 [MIT 协议全文](https://opensource.org/licenses/MIT)）。

---

## Credits / 鸣谢

- 主作者：[T8mars](https://github.com/T8mars)
- 灵感来源：PenguinPravite · Infinite Canvas · zhenzhen-web
- 特别鸣谢：[T8mars/T8-penguin-canvas](https://github.com/T8mars/T8-penguin-canvas)、T8 与企鹅画布项目，本项目在其基础上进行品牌、界面与功能改造。
- 企鹅在线画布：[https://art.pebbling.cn](https://art.pebbling.cn/?invite=T8STAR)
- 致谢上游服务：T8star · RunningHub · OpenAI 兼容生态
- 桌面端打包方案：bytenode + electron-builder + NSIS

如果这个项目对你有帮助，欢迎给一个 ⭐ Star！
