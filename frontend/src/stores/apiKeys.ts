import { create } from 'zustand';
import type { ApiSettings } from '../types/canvas';
import * as api from '../services/api';

// 三套 Key 的固定 base URL
export const FIXED_ZHENZHEN_BASE = 'https://ai.comfly.org';
export const RH_BASE = 'https://www.runninghub.cn';

interface ApiKeysState {
  settings: ApiSettings;
  loading: boolean;
  error: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  save: (patch: Partial<ApiSettings>) => Promise<void>;
}

const DEFAULT: ApiSettings = {
  zhenzhenApiKey: '',
  zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE,
  rhApiKey: '',
  rhBaseUrl: RH_BASE,
  // RH 钱包应用专用 APIKEY（RH 企业级共享 APIKEY）
  rhWalletApiKey: '',
  llmApiKey: '',
  llmBaseUrl: FIXED_ZHENZHEN_BASE,
  // 分类独立 Key（留空时 fallback 到 zhenzhenApiKey）
  gptImageApiKey: '',
  nanoBananaApiKey: '',
  mjApiKey: '',
  veoApiKey: '',
  grokApiKey: '',
  seedanceApiKey: '',
  sunoApiKey: '',
  sharedFolderPath: '',
  netdiskUrl: '',
  downloadDir: '',
  preferences: { theme: 'dark', language: 'zh-CN' },
};

export const useApiKeysStore = create<ApiKeysState>((set) => ({
  settings: DEFAULT,
  loading: false,
  error: null,
  loaded: false,

  async load() {
    set({ loading: true, error: null });
    try {
      const data = await api.getSettings();
      set({
        settings: { ...DEFAULT, ...data, zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE, llmBaseUrl: FIXED_ZHENZHEN_BASE },
        loading: false,
        loaded: true,
      });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '加载设置失败' });
    }
  },

  async save(patch) {
    set({ loading: true, error: null });
    try {
      await api.updateSettings(patch);
      // 重新拉取(后端会返回脱敏后的 Key)
      const data = await api.getSettings();
      set({
        settings: { ...DEFAULT, ...data, zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE, llmBaseUrl: FIXED_ZHENZHEN_BASE },
        loading: false,
      });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '保存失败' });
    }
  },
}));
