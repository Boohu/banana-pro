import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 支持的 provider 协议类型
export type ApiKeyProvider = 'openai' | 'gemini' | 'openai-chat' | 'gemini-chat';

export interface ApiKey {
  id: string;
  name: string;            // 用户起的名字，如 "云雾主账户"
  provider: ApiKeyProvider;
  apiBaseUrl: string;
  apiKey: string;
  createdAt: number;
}

interface ApiKeyState {
  keys: ApiKey[];
  addKey: (input: Omit<ApiKey, 'id' | 'createdAt'>) => ApiKey;
  updateKey: (id: string, patch: Partial<Omit<ApiKey, 'id' | 'createdAt'>>) => void;
  removeKey: (id: string) => void;
  getKey: (id: string) => ApiKey | undefined;
}

const genId = () => `key_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useApiKeyStore = create<ApiKeyState>()(
  persist(
    (set, get) => ({
      keys: [],
      addKey: (input) => {
        const entry: ApiKey = { ...input, id: genId(), createdAt: Date.now() };
        set((s) => ({ keys: [...s.keys, entry] }));
        return entry;
      },
      updateKey: (id, patch) => {
        set((s) => ({
          keys: s.keys.map((k) => (k.id === id ? { ...k, ...patch } : k)),
        }));
      },
      removeKey: (id) => {
        set((s) => ({ keys: s.keys.filter((k) => k.id !== id) }));
      },
      getKey: (id) => get().keys.find((k) => k.id === id),
    }),
    {
      name: 'app-api-keys-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);

// 脱敏显示，保留前 6 后 4
export function maskApiKey(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 12) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

// provider 默认 base URL
export const PROVIDER_DEFAULT_BASE: Record<ApiKeyProvider, string> = {
  'openai': 'https://api.openai.com/v1',
  'gemini': 'https://generativelanguage.googleapis.com',
  'openai-chat': 'https://api.openai.com/v1',
  'gemini-chat': 'https://generativelanguage.googleapis.com',
};

export const PROVIDER_LABEL: Record<ApiKeyProvider, string> = {
  'openai': 'OpenAI (生图)',
  'gemini': 'Gemini (生图)',
  'openai-chat': 'OpenAI (对话/识图)',
  'gemini-chat': 'Gemini (对话/识图)',
};
