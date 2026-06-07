# App Source

这是后改版本的干净源码目录，可以作为 GitHub 仓库根目录使用。

## 目录

- `frontend/` - 前台源码，React/Vite。
- `service/` - Rust 本地后台服务源码。
- `desktop-shell/` - 桌面壳源码，负责启动本地后台并打开前台页面。

## 不上传的内容

下面这些是依赖、构建产物、运行数据或本地密钥，不应该上传：

- `node_modules/`
- `target/`
- `dist/`
- `data/`
- `input/`
- `output/`
- `thumbnails/`
- `.env`

## 首次安装

需要先安装 Node.js、Rust 和 Tauri 相关依赖。

```powershell
cd X:\AI_Workspace\iMade\app-source\frontend
npm install

cd X:\AI_Workspace\iMade\app-source\desktop-shell
npm install
```

Rust 后台不需要手动安装依赖，构建时会由 Cargo 自动下载。

## 构建前台

```powershell
cd X:\AI_Workspace\iMade\app-source\frontend
npm run build
```

生成目录：

```text
frontend\dist
```

## 构建 Rust 后台

```powershell
cd X:\AI_Workspace\iMade\app-source\service
cargo build --release
```

生成文件：

```text
service\target\release\service.exe
```

## 启动桌面程序开发版

```powershell
cd X:\AI_Workspace\iMade\app-source\desktop-shell
npm run app:dev
```

这个命令会先构建前台和 Rust 后台，然后启动桌面壳。

## 打包安装程序

```powershell
cd X:\AI_Workspace\iMade\app-source\desktop-shell
npm run app:build
```

打包时会把下面两个产物一起放进安装包：

```text
frontend\dist
service\target\release\service.exe
```

## 上传 GitHub

把 `app-source` 作为仓库根目录上传即可。不要上传原来的 `huazaiai-main` 整个目录。
