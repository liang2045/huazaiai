import * as api from '../services/api';
import { apiUrl } from '../services/apiBase';
import { useApiKeysStore } from '../stores/apiKeys';

export interface DownloadResult {
  path?: string;
  directory?: string;
  fileName?: string;
}

function notifyDownloadComplete(detail: DownloadResult) {
  window.dispatchEvent(new CustomEvent('imade:download-complete', { detail }));
}

function notifyDownloadError(message: string, directory?: string) {
  window.dispatchEvent(new CustomEvent('imade:download-error', { detail: { message, directory } }));
}

function fileNameFromUrl(url: string, fallback: string) {
  if (url.startsWith('blob:') || url.startsWith('data:')) return fallback;
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const name = decodeURIComponent(pathname.split('/').pop() || '');
    if (name) return name;
  } catch {
    // Fall back below.
  }
  return fallback;
}

function cacheBustedUrl(url: string) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    const isLocalAsset =
      parsed.origin === window.location.origin &&
      (
        parsed.pathname.startsWith('/files/') ||
        parsed.pathname.startsWith('/output/') ||
        parsed.pathname.startsWith('/input/')
      );
    if (!isLocalAsset) return url;
    parsed.searchParams.set('downloadTs', String(Date.now()));
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return url;
  }
}

export async function downloadAsset(url: string, fallbackName = 'asset'): Promise<DownloadResult | undefined> {
  if (!url) return undefined;
  let settings = useApiKeysStore.getState().settings;
  try {
    const fresh = await api.getSettings();
    useApiKeysStore.setState({ settings: { ...settings, ...fresh }, loaded: true });
    settings = { ...settings, ...fresh };
  } catch {
    // Use the in-memory settings if the settings endpoint is unavailable.
  }

  const directory = settings.downloadDir?.trim();
  const fileName = fileNameFromUrl(url, fallbackName);
  const requestUrl = cacheBustedUrl(url);

  if (window.imade?.downloadToDirectory && directory) {
    const result = await window.imade.downloadToDirectory({ url: requestUrl, directory, fileName });
    if (result.ok) {
      const done = { path: result.path, directory, fileName };
      notifyDownloadComplete(done);
      return done;
    }
    console.warn('Desktop download failed, trying backend directory download:', result.error);
  }

  try {
    const res = await fetch(apiUrl('/api/files/download-to-directory'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: requestUrl, directory, fileName }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.success) {
      const done = {
        path: json?.data?.path,
        directory: json?.data?.directory || directory,
        fileName: json?.data?.fileName || fileName,
      };
      notifyDownloadComplete(done);
      return done;
    }
    throw new Error(json?.error || `HTTP ${res.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notifyDownloadError(`下载失败: ${message}`, directory);
    return undefined;
  }
}

export async function downloadBlob(blob: Blob, fallbackName = 'asset.png'): Promise<DownloadResult | undefined> {
  if (!blob) return undefined;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('blob read failed'));
      reader.readAsDataURL(blob);
    });
    const res = await fetch(apiUrl('/api/files/upload-base64'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, prefix: 'frame' }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.success && json?.data?.url) {
      return await downloadAsset(json.data.url, fallbackName);
    }
    throw new Error(json?.error || `HTTP ${res.status}`);
  } catch (err) {
    notifyDownloadError(`下载失败: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
