import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ReversePromptStyle } from '@/services/promptApi';

// 单条历史记录
export interface ReversePromptRecord {
  id: string;
  thumbnail: string; // base64 data URL（压缩后的缩略图，≤ 160px）
  promptZh: string;
  promptEn: string;
  style: ReversePromptStyle;
  customStyle?: string;
  modelName: string;
  createdAt: number; // unix ms
}

interface PromptReverseState {
  history: ReversePromptRecord[];
  addRecord: (record: ReversePromptRecord) => void;
  removeRecord: (id: string) => void;
  clearHistory: () => void;
}

const MAX_HISTORY = 20;

export const usePromptReverseStore = create<PromptReverseState>()(
  persist(
    (set) => ({
      history: [],
      addRecord: (record) =>
        set((state) => ({
          history: [record, ...state.history].slice(0, MAX_HISTORY),
        })),
      removeRecord: (id) =>
        set((state) => ({
          history: state.history.filter((r) => r.id !== id),
        })),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'banana-prompt-reverse',
      version: 1,
    },
  ),
);

// 生成缩略图：把 File 压缩成 160px 的 base64 data URL
export async function generateThumbnail(file: File, maxSize = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d unavailable');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片加载失败'));
    };
    img.src = objectUrl;
  });
}
