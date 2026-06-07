/**
 * iMade 后端 API 封装
 * 所有请求走 Vite proxy → http://127.0.0.1:18766
 */
import type { ApiSettings, CanvasData, CanvasListItem } from '../types/canvas';
import { apiUrl } from './apiBase';

const BASE = apiUrl('/api');

export type AppConfig = {
  appName: string;
  logoUrl: string;
  version?: string;
  themeColor: string;
  licenseStatus: 'trial' | 'active' | 'expired' | 'offline' | string;
  customerId: string;
  machineId: string;
  expiresAt?: string | null;
  lastSyncAt?: string | null;
  features: string[];
  updateUrl: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      errMsg = data.error || errMsg;
    } catch {
      /* ignore */
    }
    throw new Error(errMsg);
  }
  return res.json();
}

// ========== 状态 ==========
export async function checkBackendStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/status`);
    return res.ok;
  } catch {
    return false;
  }
}

// ========== 应用品牌/授权配置 ==========
export async function getAppConfig(): Promise<AppConfig> {
  const res = await request<{ success: boolean; data: AppConfig }>(`${BASE}/app/config`);
  return res.data;
}

export async function refreshAppConfig(): Promise<AppConfig> {
  const res = await request<{ success: boolean; data: AppConfig }>(`${BASE}/app/config/refresh`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return res.data;
}

// ========== 画布列表 ==========
export async function listCanvases(): Promise<CanvasListItem[]> {
  const res = await request<{ success: boolean; data: CanvasListItem[] }>(`${BASE}/canvas`);
  return res.data || [];
}

export async function createCanvas(name?: string): Promise<CanvasListItem> {
  const res = await request<{ success: boolean; data: CanvasListItem }>(`${BASE}/canvas`, {
    method: 'POST',
    body: JSON.stringify({ name: name || '未命名画布' }),
  });
  return res.data;
}

export async function getCanvasData(id: string): Promise<CanvasData> {
  const res = await request<{ success: boolean; data: CanvasData }>(`${BASE}/canvas/${id}`);
  return res.data;
}

export async function saveCanvasData(id: string, data: CanvasData): Promise<void> {
  await request(`${BASE}/canvas/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteCanvas(id: string): Promise<void> {
  await request(`${BASE}/canvas/${id}`, { method: 'DELETE' });
}

export async function renameCanvas(id: string, name: string): Promise<CanvasListItem> {
  const res = await request<{ success: boolean; data: CanvasListItem }>(
    `${BASE}/canvas/${id}/name`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }
  );
  return res.data;
}

// ========== 设置(三套通用 Key + 分类 Key) ==========
export async function getSettings(): Promise<ApiSettings> {
  const res = await request<{ success: boolean; data: ApiSettings }>(`${BASE}/settings`);
  return res.data;
}

export async function updateSettings(patch: Partial<ApiSettings>): Promise<void> {
  await request(`${BASE}/settings`, {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}
