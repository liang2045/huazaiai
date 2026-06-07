import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CanvasTheme = 'dark' | 'light';
export type ThemeStyle = 'tech' | 'pixel';

interface ThemeState {
  theme: CanvasTheme;
  style: ThemeStyle;
  toggleTheme: () => void;
  setTheme: (theme: CanvasTheme) => void;
  setStyle: (style: ThemeStyle) => void;
}

/**
 * 主题状态管理(支持持久化到 localStorage)
 * - theme: dark | light 明暗模式
 * - style: tech | pixel 视觉风格
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      // 默认主题：Grok 风格的科技深色模式（跟随风格联动）
      theme: 'dark',
      style: 'tech',
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      setTheme: (theme) => set({ theme }),
      setStyle: () => set({ style: 'tech' }),
    }),
    {
      name: 'imade-theme',
      version: 2,
      migrate: (persisted: any) => ({
        ...persisted,
        theme: persisted?.theme === 'light' ? 'light' : 'dark',
        style: 'tech',
      }),
    }
  )
);
