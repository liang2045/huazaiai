/**
 * 文件上传/下载路由
 * 用于:用户从本地上传参考图,后续传给图像生成接口
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { spawn } = require('child_process');
const config = require('../config');

const router = express.Router();

function safeFileName(name) {
  return String(name || `download-${Date.now()}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 180);
}

function inferFileName(url, fallback) {
  if (fallback) return safeFileName(fallback);
  try {
    const pathname = new URL(url, 'http://127.0.0.1').pathname;
    const base = path.basename(decodeURIComponent(pathname));
    if (base && base !== '/') return safeFileName(base);
  } catch (_) {}
  return safeFileName(`download-${Date.now()}`);
}

function uniqueTargetPath(targetDir, fileName) {
  const parsed = path.parse(fileName);
  let target = path.join(targetDir, fileName);
  let i = 1;
  while (fs.existsSync(target)) {
    target = path.join(targetDir, `${parsed.name}-${i}${parsed.ext}`);
    i += 1;
  }
  return target;
}

function getLocalAssetPath(url) {
  try {
    const pathname = url.startsWith('/')
      ? url
      : new URL(url, 'http://127.0.0.1').pathname;
    const decoded = decodeURIComponent(pathname);
    const roots = [
      ['/files/output/', config.OUTPUT_DIR],
      ['/output/', config.OUTPUT_DIR],
      ['/files/input/', config.INPUT_DIR],
      ['/input/', config.INPUT_DIR],
      ['/files/thumbnails/', config.THUMBNAILS_DIR],
    ];
    for (const [prefix, dir] of roots) {
      if (!decoded.startsWith(prefix)) continue;
      const rel = decoded.slice(prefix.length);
      const full = path.resolve(dir, rel);
      const base = path.resolve(dir);
      if (full === base || !full.startsWith(base + path.sep)) return '';
      return full;
    }
  } catch (_) {}
  return '';
}

function walkMediaFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          const stat = fs.statSync(full);
          out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch (_) {}
      }
    }
  }
  return out;
}

function readReferencedAssetPaths() {
  const refs = new Set();
  const addUrl = (value) => {
    if (typeof value !== 'string' || !value) return;
    const local = getLocalAssetPath(value);
    if (local) refs.add(path.resolve(local));
  };
  const visit = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      addUrl(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  try {
    const files = fs.readdirSync(config.DATA_DIR)
      .filter((name) => /^canvas_.*\.json$/i.test(name));
    for (const file of files) {
      const full = path.join(config.DATA_DIR, file);
      const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
      visit(data);
    }
  } catch (_) {}
  return refs;
}

function cacheSummary() {
  const dirs = [
    { key: 'output', dir: config.OUTPUT_DIR },
    { key: 'input', dir: config.INPUT_DIR },
    { key: 'thumbnails', dir: config.THUMBNAILS_DIR },
  ];
  const byDir = {};
  let totalSize = 0;
  let totalFiles = 0;
  for (const item of dirs) {
    const files = walkMediaFiles(item.dir);
    const size = files.reduce((sum, f) => sum + f.size, 0);
    byDir[item.key] = { path: item.dir, files: files.length, size };
    totalSize += size;
    totalFiles += files.length;
  }
  return { totalSize, totalFiles, byDir };
}

function cleanupCache(days = 7) {
  const cutoff = Date.now() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
  const refs = readReferencedAssetPaths();
  const files = [
    ...walkMediaFiles(config.OUTPUT_DIR),
    ...walkMediaFiles(config.INPUT_DIR),
    ...walkMediaFiles(config.THUMBNAILS_DIR),
  ];
  let removedFiles = 0;
  let removedSize = 0;
  for (const file of files) {
    const full = path.resolve(file.path);
    if (refs.has(full)) continue;
    if (file.mtimeMs > cutoff) continue;
    try {
      fs.unlinkSync(full);
      removedFiles += 1;
      removedSize += file.size;
    } catch (_) {}
  }
  return { removedFiles, removedSize, summary: cacheSummary() };
}

function getConfiguredDownloadDir() {
  try {
    if (!fs.existsSync(config.SETTINGS_FILE)) return '';
    const settings = JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf-8'));
    return typeof settings.downloadDir === 'string' ? settings.downloadDir.trim() : '';
  } catch (_) {
    return '';
  }
}

function openDirectory(targetDir) {
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [targetDir], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [targetDir], { detached: true, stdio: 'ignore' });
  child.unref();
}

function openLocalPath(targetPath) {
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [targetPath], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [targetPath], { detached: true, stdio: 'ignore' });
  child.unref();
}

function makeThumbnailCacheName(localPath, width, height) {
  const stat = fs.statSync(localPath);
  const key = `${localPath}:${stat.size}:${stat.mtimeMs}:${width}:${height}`;
  return `${crypto.createHash('sha1').update(key).digest('hex')}.webp`;
}

// 配置 multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.INPUT_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const name = `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE },
});

// POST /api/files/upload — 上传文件
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '未收到文件' });
  }
  res.json({
    success: true,
    data: {
      filename: req.file.filename,
      url: `/files/input/${req.file.filename}`,
      size: req.file.size,
      mime: req.file.mimetype,
    },
  });
});

router.get('/thumbnail', async (req, res) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    const width = Math.min(640, Math.max(80, Number(req.query.w || 320) || 320));
    const height = Math.min(640, Math.max(60, Number(req.query.h || 240) || 240));
    const localPath = getLocalAssetPath(url);
    if (!localPath || !fs.existsSync(localPath)) {
      return res.status(404).json({ success: false, error: 'thumbnail source not found' });
    }

    fs.mkdirSync(config.THUMBNAILS_DIR, { recursive: true });
    const filename = makeThumbnailCacheName(localPath, width, height);
    const target = path.join(config.THUMBNAILS_DIR, filename);

    if (!fs.existsSync(target)) {
      await sharp(localPath)
        .rotate()
        .resize(width, height, { fit: 'cover', position: 'centre' })
        .webp({ quality: 72 })
        .toFile(target);
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(target);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/files/download-to-directory - save a canvas asset to a configured local directory.
router.post('/download-to-directory', async (req, res) => {
  try {
    const targetDir =
      req.body && typeof req.body.directory === 'string' && req.body.directory.trim()
        ? req.body.directory.trim()
        : getConfiguredDownloadDir();
    let url = req.body && typeof req.body.url === 'string' ? req.body.url : '';
    if (!targetDir || !url) {
      return res.status(400).json({ success: false, error: 'missing directory or url' });
    }

    fs.mkdirSync(targetDir, { recursive: true });
    const fileName = inferFileName(url, req.body.fileName);
    const target = uniqueTargetPath(targetDir, fileName);

    if (url.startsWith('data:')) {
      const match = /^data:.*?;base64,(.*)$/i.exec(url);
      if (!match) return res.status(400).json({ success: false, error: 'unsupported data url' });
      fs.writeFileSync(target, Buffer.from(match[1], 'base64'));
      return res.json({ success: true, data: { path: target, directory: targetDir, fileName: path.basename(target) } });
    }

    const localPath = getLocalAssetPath(url);
    if (localPath && fs.existsSync(localPath)) {
      fs.copyFileSync(localPath, target);
      return res.json({ success: true, data: { path: target, directory: targetDir, fileName: path.basename(target) } });
    }

    if (url.startsWith('/')) {
      url = `${req.protocol}://${req.get('host')}${url}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(400).json({ success: false, error: `download failed HTTP ${response.status}` });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(target, buffer);
    res.json({ success: true, data: { path: target, directory: targetDir, fileName: path.basename(target) } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/cache-stats', (_req, res) => {
  try {
    res.json({ success: true, data: cacheSummary() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/cache-cleanup', (req, res) => {
  try {
    const days = req.body && typeof req.body.days === 'number' ? req.body.days : 7;
    res.json({ success: true, data: cleanupCache(days) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

try {
  cleanupCache(Number(process.env.IMADE_CACHE_CLEAN_DAYS || 7));
} catch (_) {}

// POST /api/files/open-download-directory - open the configured download directory.
router.post('/open-download-directory', (_req, res) => {
  try {
    const targetDir = getConfiguredDownloadDir();
    if (!targetDir) return res.status(400).json({ success: false, error: 'download directory is not configured' });
    if (!fs.existsSync(targetDir)) return res.status(404).json({ success: false, error: 'download directory does not exist' });
    openDirectory(targetDir);
    res.json({ success: true, data: { directory: targetDir } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/files/list — 列出 output 目录
router.post('/open-path', (req, res) => {
  try {
    const targetPath = req.body && typeof req.body.path === 'string' ? req.body.path.trim() : '';
    if (!targetPath) return res.status(400).json({ success: false, error: 'path is not configured' });
    if (!fs.existsSync(targetPath)) return res.status(404).json({ success: false, error: 'path does not exist' });
    openLocalPath(targetPath);
    res.json({ success: true, data: { path: targetPath } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/list', (_req, res) => {
  try {
    const files = fs.readdirSync(config.OUTPUT_DIR)
      .filter((f) => /\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav)$/i.test(f))
      .map((f) => {
        const stat = fs.statSync(path.join(config.OUTPUT_DIR, f));
        return {
          filename: f,
          url: `/files/output/${f}`,
          size: stat.size,
          mtime: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ success: true, data: files });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/files/upload-base64 — 从 base64 dataURL 保存 PNG/JPG 到 OUTPUT_DIR
// 供手绘画板 / 抽帧等前端产生的图像使用
router.post('/upload-base64', express.json({ limit: '20mb' }), (req, res) => {
  try {
    const { dataUrl, prefix } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ success: false, error: '缺少 dataUrl' });
    }
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl);
    if (!m) {
      return res.status(400).json({ success: false, error: 'dataUrl 格式不支持' });
    }
    const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    const tag = (prefix || 'draw').replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'draw';
    const filename = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext === 'jpeg' ? 'png' : ext}`;
    const fp = path.join(config.OUTPUT_DIR, filename);
    fs.writeFileSync(fp, buf);
    res.json({
      success: true,
      data: {
        filename,
        url: `/files/output/${filename}`,
        size: buf.length,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
