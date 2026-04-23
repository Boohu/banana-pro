import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PersistedRefImage } from '../types';

// Model constants to avoid magic strings
export const IMAGE_MODELS = {
  FLASH: { value: 'gemini-3.1-flash-image-preview', label: 'Flash 3.1' },
  PRO: { value: 'gemini-3-pro-image-preview', label: 'Pro' },
} as const;

// Model options for the dropdown selectors
export const IMAGE_MODEL_OPTIONS = [
  { value: IMAGE_MODELS.FLASH.value, label: `${IMAGE_MODELS.FLASH.label} (${IMAGE_MODELS.FLASH.value})` },
  { value: IMAGE_MODELS.PRO.value, label: `${IMAGE_MODELS.PRO.label} (${IMAGE_MODELS.PRO.value})` },
] as const;

export const CUSTOM_MODEL_VALUE = '__custom__';

// Model configuration with supported aspect ratios
export const IMAGE_MODEL_CONFIG: Record<string, { aspectRatios: string[]; resolutions?: string[] }> = {
  [IMAGE_MODELS.FLASH.value]: {
    aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9']
  },
  [IMAGE_MODELS.PRO.value]: {
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
  },
  // gpt-image-2 系列：size 只支持 1024×1024 / 1536×1024 / 1024×1536 / 2048×2048 / 2048×1152 / 3840×2160 / 2160×3840 / auto
  'gpt-image-2': {
    aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16'],
    resolutions: ['1K', '2K', '4K'],
  },
  'gpt-image-2-all': {
    aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16'],
    resolutions: ['1K', '2K', '4K'],
  },
};

// Default aspect ratios for custom/unknown models
const DEFAULT_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const DEFAULT_RESOLUTIONS = ['1K', '2K', '4K'];

// Helper function to get supported aspect ratios for a model
export const getModelAspectRatios = (model: string): string[] => {
  const ratios = IMAGE_MODEL_CONFIG[model]?.aspectRatios;
  return (ratios && ratios.length > 0) ? ratios : DEFAULT_ASPECT_RATIOS;
};

// 获取模型支持的分辨率档（图生图时 gpt-image-* 只剩 1K）
export const getModelResolutions = (model: string, hasRef = false): string[] => {
  if (model.startsWith('gpt-image-') && hasRef) {
    return ['1K']; // 云雾 /v1/images/edits 只支持 1024/1536（都属 1K 档）
  }
  const list = IMAGE_MODEL_CONFIG[model]?.resolutions;
  return (list && list.length > 0) ? list : DEFAULT_RESOLUTIONS;
};

// 图生图模式下是否允许 auto 比例（跟随参考图）
export const modelSupportsAutoRatio = (model: string): boolean => {
  return model.startsWith('gpt-image-');
};

export interface GPTImageSizeResolved {
  size: string;      // 实际 size 字符串，如 "1024x1024" 或 "auto"
  fallback: boolean; // 是否发生档位回落
  note?: string;     // 回落说明（中文）
}

// 前端镜像后端 resolveGPTImageSize 的规则，用于 UI 提示
// hasRef=true 时图生图只能 1K 档 + auto
export const resolveGPTImageSize = (
  aspectRatio: string,
  imageSize: string,
  hasRef: boolean
): GPTImageSizeResolved => {
  if (aspectRatio === 'auto') return { size: 'auto', fallback: false };
  const lvl = (imageSize || '').toLowerCase();

  if (hasRef) {
    if (aspectRatio === '3:2' || aspectRatio === '16:9') return { size: '1536x1024', fallback: false };
    if (aspectRatio === '2:3' || aspectRatio === '9:16') return { size: '1024x1536', fallback: false };
    if (aspectRatio === '1:1') return { size: '1024x1024', fallback: false };
    return { size: 'auto', fallback: false };
  }

  if (lvl === '4k') {
    if (aspectRatio === '3:2' || aspectRatio === '16:9') return { size: '3840x2160', fallback: false };
    if (aspectRatio === '2:3' || aspectRatio === '9:16') return { size: '2160x3840', fallback: false };
    if (aspectRatio === '1:1') return { size: '2048x2048', fallback: true, note: '官方无 4K 方图，回落到 2K 方图' };
  }
  if (lvl === '2k') {
    if (aspectRatio === '3:2' || aspectRatio === '16:9') return { size: '2048x1152', fallback: false };
    if (aspectRatio === '2:3' || aspectRatio === '9:16') return { size: '1024x1536', fallback: true, note: '官方无 2K 竖图，回落到 1K 竖图' };
    if (aspectRatio === '1:1') return { size: '2048x2048', fallback: false };
  }
  // 1K
  if (aspectRatio === '3:2' || aspectRatio === '16:9') return { size: '1536x1024', fallback: false };
  if (aspectRatio === '2:3' || aspectRatio === '9:16') return { size: '1024x1536', fallback: false };
  if (aspectRatio === '1:1') return { size: '1024x1024', fallback: false };
  return { size: '1024x1024', fallback: false };
};

interface ConfigState {
  // 生图配置（旧扁平字段，保留兼容，v13 后由 selectedImageModelId 主导）
  imageProvider: string;
  imageApiBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
  imageTimeoutSeconds: number;
  // 识图配置（逆向提示词用）
  visionProvider: string;
  visionApiBaseUrl: string;
  visionApiKey: string;
  visionModel: string;
  visionTimeoutSeconds: number;
  visionSyncedConfig: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    timeoutSeconds: number;
  } | null;
  enableRefImageCompression: boolean;

  // 对话配置
  chatProvider: string;
  chatApiBaseUrl: string;
  chatApiKey: string;
  chatModel: string;
  chatTimeoutSeconds: number;
  chatSyncedConfig: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    timeoutSeconds: number;
  } | null;

  // v13 新增：统一模型引用（指向 modelStore 里的 CustomModel.id）
  selectedImageModelId: string | null;
  selectedVisionModelId: string | null;
  selectedChatModelId: string | null;

  language: string;
  languageResolved: string | null;
  
  prompt: string;
  count: number;
  imageSize: string;
  aspectRatio: string;
  refFiles: File[];
  refImageEntries: PersistedRefImage[];
  draftBatchId: string | null;

  setImageProvider: (provider: string) => void;
  setImageApiBaseUrl: (url: string) => void;
  setImageApiKey: (key: string) => void;
  setImageModel: (model: string) => void;
  setImageTimeoutSeconds: (seconds: number) => void;
  setVisionProvider: (provider: string) => void;
  setVisionApiBaseUrl: (url: string) => void;
  setVisionApiKey: (key: string) => void;
  setVisionModel: (model: string) => void;
  setVisionTimeoutSeconds: (seconds: number) => void;
  setVisionSyncedConfig: (config: { apiBaseUrl: string; apiKey: string; model: string; timeoutSeconds: number } | null) => void;
  setEnableRefImageCompression: (enabled: boolean) => void;
  setChatProvider: (provider: string) => void;
  setChatApiBaseUrl: (url: string) => void;
  setChatApiKey: (key: string) => void;
  setChatModel: (model: string) => void;
  setChatTimeoutSeconds: (seconds: number) => void;
  setChatSyncedConfig: (config: { apiBaseUrl: string; apiKey: string; model: string; timeoutSeconds: number } | null) => void;
  setLanguage: (language: string) => void;
  setLanguageResolved: (languageResolved: string | null) => void;
  setPrompt: (prompt: string) => void;
  setCount: (count: number) => void;
  setImageSize: (size: string) => void;
  setAspectRatio: (ratio: string) => void;
  setRefFiles: (files: File[]) => void;
  addRefFiles: (files: File[]) => void;
  removeRefFile: (index: number) => void;
  clearRefFiles: () => void;
  setRefImageEntries: (entries: PersistedRefImage[]) => void;
  setDraftBatchId: (id: string | null) => void;
  setSelectedImageModelId: (id: string | null) => void;
  setSelectedVisionModelId: (id: string | null) => void;
  setSelectedChatModelId: (id: string | null) => void;

  reset: () => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      imageProvider: 'gemini',
      imageApiBaseUrl: 'https://generativelanguage.googleapis.com',
      imageApiKey: '',
      imageModel: 'gemini-3-flash-image-preview',
      imageTimeoutSeconds: 500,
      // 识图配置（逆向提示词用）
      visionProvider: 'gemini-chat',
      visionApiBaseUrl: '',
      visionApiKey: '',
      visionModel: 'gemini-3-flash-preview',
      visionTimeoutSeconds: 150,
      visionSyncedConfig: null,
      enableRefImageCompression: true,
      chatProvider: 'openai-chat',
      chatApiBaseUrl: 'https://api.openai.com/v1',
      chatApiKey: '',
      chatModel: 'gemini-3-flash-preview',
      chatTimeoutSeconds: 150,
      chatSyncedConfig: null,
      language: 'system',
      languageResolved: null,
      prompt: '',
      count: 1,
      imageSize: '2K',
      aspectRatio: '1:1',
      refFiles: [],
      refImageEntries: [],
      draftBatchId: null,
      selectedImageModelId: null,
      selectedVisionModelId: null,
      selectedChatModelId: null,

      setImageProvider: (imageProvider) => set({ imageProvider }),
      setImageApiBaseUrl: (imageApiBaseUrl) => set({ imageApiBaseUrl }),
      setImageApiKey: (imageApiKey) => set({ imageApiKey }),
      setImageModel: (imageModel) => set({ imageModel }),
      setImageTimeoutSeconds: (imageTimeoutSeconds) => set({ imageTimeoutSeconds }),
      setVisionProvider: (visionProvider) => set({ visionProvider }),
      setVisionApiBaseUrl: (visionApiBaseUrl) => set({ visionApiBaseUrl }),
      setVisionApiKey: (visionApiKey) => set({ visionApiKey }),
      setVisionModel: (visionModel) => set({ visionModel }),
      setVisionTimeoutSeconds: (visionTimeoutSeconds) => set({ visionTimeoutSeconds }),
      setVisionSyncedConfig: (visionSyncedConfig) => set({ visionSyncedConfig }),
      setEnableRefImageCompression: (enableRefImageCompression) => set({ enableRefImageCompression }),
      setChatProvider: (chatProvider) => set({ chatProvider }),
      setChatApiBaseUrl: (chatApiBaseUrl) => set({ chatApiBaseUrl }),
      setChatApiKey: (chatApiKey) => set({ chatApiKey }),
      setChatModel: (chatModel) => set({ chatModel }),
      setChatTimeoutSeconds: (chatTimeoutSeconds) => set({ chatTimeoutSeconds }),
      setChatSyncedConfig: (chatSyncedConfig) => set({ chatSyncedConfig }),
      setLanguage: (language) => set({ language }),
      setLanguageResolved: (languageResolved) => set({ languageResolved }),
      setPrompt: (prompt) => set({ prompt }),
      setCount: (count) => set({ count }),
      setImageSize: (imageSize) => set({ imageSize }),
      setAspectRatio: (aspectRatio) => set({ aspectRatio }),
      setRefFiles: (refFiles) => set({ refFiles }),
      setRefImageEntries: (refImageEntries) => set({ refImageEntries }),
      setDraftBatchId: (draftBatchId) => set({ draftBatchId }),
      setSelectedImageModelId: (selectedImageModelId) => set({ selectedImageModelId }),
      setSelectedVisionModelId: (selectedVisionModelId) => set({ selectedVisionModelId }),
      setSelectedChatModelId: (selectedChatModelId) => set({ selectedChatModelId }),

      addRefFiles: (files) => set((state) => ({
          // 限制最多 10 张
          refFiles: [...state.refFiles, ...files].slice(0, 10)
      })),

      removeRefFile: (index) => set((state) => ({
          refFiles: state.refFiles.filter((_, i) => i !== index)
      })),

      clearRefFiles: () => set({ refFiles: [] }),

      reset: () => set({
        imageApiBaseUrl: 'https://generativelanguage.googleapis.com',
        imageModel: 'gemini-3-flash-image-preview',
        imageTimeoutSeconds: 500,
      // 识图配置（逆向提示词用）
      visionProvider: 'gemini-chat',
      visionApiBaseUrl: '',
      visionApiKey: '',
      visionModel: 'gemini-3-flash-preview',
      visionTimeoutSeconds: 150,
      visionSyncedConfig: null,
        chatProvider: 'openai-chat',
        chatApiBaseUrl: 'https://api.openai.com/v1',
        chatModel: 'gemini-3-flash-preview',
        chatTimeoutSeconds: 150,
        chatSyncedConfig: null,
        prompt: '',
        count: 1,
        imageSize: '2K',
        aspectRatio: '1:1',
        refFiles: [],
        refImageEntries: [],
        draftBatchId: null,
      })
    }),
    {
      name: 'app-config-storage',
      storage: createJSONStorage(() => localStorage),
      version: 13,
      // 关键：不要将 File 对象序列化到 localStorage（File 对象无法序列化）
      partialize: (state) => {
          const { refFiles, ...rest } = state;
          return rest;
      },
      // 每次 hydrate 完成后执行：自愈 migrate（延后到下一个 tick 避免循环依赖）
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        setTimeout(() => { void selfHealMigrate(state); }, 0);
      },
      migrate: (persistedState, version) => {
        const state = persistedState as any;
        let next = state;
        if (version < 2) {
          next = {
            ...state,
            imageProvider: state.imageProvider ?? state.provider ?? 'gemini',
            imageApiBaseUrl: state.imageApiBaseUrl ?? state.apiBaseUrl ?? 'https://generativelanguage.googleapis.com',
            imageApiKey: state.imageApiKey ?? state.apiKey ?? '',
            imageModel: state.imageModel ?? state.model ?? 'gemini-3-flash-image-preview',
            chatApiBaseUrl: state.chatApiBaseUrl ?? 'https://api.openai.com/v1',
            chatApiKey: state.chatApiKey ?? '',
            chatModel: state.chatModel ?? state.textModel ?? '',
          };
        }
        if (version < 3) {
          const chatKey = String(next.chatApiKey ?? '').trim();
          const chatModel = String(next.chatModel ?? '').trim();
          const shouldDefault = !chatKey && (chatModel === '' || chatModel === 'gpt-4o-mini');
          if (shouldDefault) {
            next = { ...next, chatModel: 'gemini-3-flash-preview' };
          }
        }
        if (version < 4) {
          next = { ...next, chatSyncedConfig: next.chatSyncedConfig ?? null };
        }
        if (version < 5) {
          const base = String(next.chatApiBaseUrl ?? '').toLowerCase();
          const model = String(next.chatModel ?? '').toLowerCase();
          const inferred = base.includes('generativelanguage') || model.startsWith('gemini')
            ? 'gemini-chat'
            : 'openai-chat';
          next = { ...next, chatProvider: next.chatProvider ?? inferred };
        }
        if (version < 6) {
          next = { ...next, refImageEntries: next.refImageEntries ?? [] };
        }
        if (version < 7) {
          next = { ...next, language: next.language ?? '' };
        }
        if (version < 8) {
          const rawLanguage = typeof next.language === 'string' ? next.language.trim() : '';
          next = {
            ...next,
            language: rawLanguage ? next.language : 'system',
            languageResolved: next.languageResolved ?? null
          };
        }
        if (version < 9) {
          next = {
            ...next,
            imageTimeoutSeconds: next.imageTimeoutSeconds ?? 500,
            chatTimeoutSeconds: next.chatTimeoutSeconds ?? 150
          };
          if (next.chatSyncedConfig && next.chatSyncedConfig.timeoutSeconds == null) {
            next = {
              ...next,
              chatSyncedConfig: {
                ...next.chatSyncedConfig,
                timeoutSeconds: next.chatTimeoutSeconds ?? 150
              }
            };
          }
        }
        if (version < 11) {
          next = { ...next, draftBatchId: next.draftBatchId ?? null };
        }
        if (version < 12) {
          // 旧模型自动迁移到 3.1 版本
          if (next.imageModel === 'gemini-3-flash-image-preview') {
            next = { ...next, imageModel: 'gemini-3.1-flash-image-preview' };
          }
        }
        if (version < 13) {
          // v13：把旧扁平配置迁移到 apiKeyStore + modelStore
          // 直接写两个 store 的 localStorage，它们初始化时会自动读取
          try {
            const genId = (prefix: string) =>
              `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            const apiKeys: any[] = [];
            const models: any[] = [];

            // 1. 迁移图像配置
            if (next.imageApiKey && next.imageApiBaseUrl) {
              const imgKeyId = genId('key');
              apiKeys.push({
                id: imgKeyId,
                name: next.imageProvider === 'gemini' ? 'Gemini 生图' : 'OpenAI 生图',
                provider: next.imageProvider || 'gemini',
                apiBaseUrl: next.imageApiBaseUrl,
                apiKey: next.imageApiKey,
                createdAt: Date.now(),
              });
              const imgModelId = genId('model');
              models.push({
                id: imgModelId,
                name: next.imageModel || 'gemini-3.1-flash-image-preview',
                apiKeyId: imgKeyId,
                purpose: 'image',
                createdAt: Date.now(),
              });
              next = { ...next, selectedImageModelId: imgModelId };

              // 迁移旧的自定义模型列表（string[]）到 modelStore，绑定到同一把图像 key
              try {
                const oldCustom = JSON.parse(localStorage.getItem('banana-custom-models') || '[]');
                if (Array.isArray(oldCustom)) {
                  for (const name of oldCustom) {
                    if (typeof name === 'string' && name.trim()) {
                      models.push({
                        id: genId('model'),
                        name: name.trim(),
                        apiKeyId: imgKeyId,
                        purpose: 'image',
                        createdAt: Date.now(),
                      });
                    }
                  }
                }
              } catch {}
            }

            // 2. 迁移识图配置
            if (next.visionApiKey && next.visionApiBaseUrl) {
              const vKeyId = genId('key');
              apiKeys.push({
                id: vKeyId,
                name: next.visionProvider === 'gemini-chat' ? 'Gemini 识图' : 'OpenAI 识图',
                provider: next.visionProvider || 'gemini-chat',
                apiBaseUrl: next.visionApiBaseUrl,
                apiKey: next.visionApiKey,
                createdAt: Date.now(),
              });
              const vModelId = genId('model');
              models.push({
                id: vModelId,
                name: next.visionModel || 'gemini-3-flash-preview',
                apiKeyId: vKeyId,
                purpose: 'vision',
                createdAt: Date.now(),
              });
              next = { ...next, selectedVisionModelId: vModelId };
            }

            // 3. 迁移对话配置
            if (next.chatApiKey && next.chatApiBaseUrl) {
              const cKeyId = genId('key');
              apiKeys.push({
                id: cKeyId,
                name: next.chatProvider === 'gemini-chat' ? 'Gemini 对话' : 'OpenAI 对话',
                provider: next.chatProvider || 'openai-chat',
                apiBaseUrl: next.chatApiBaseUrl,
                apiKey: next.chatApiKey,
                createdAt: Date.now(),
              });
              const cModelId = genId('model');
              models.push({
                id: cModelId,
                name: next.chatModel || 'gemini-3-flash-preview',
                apiKeyId: cKeyId,
                purpose: 'chat',
                createdAt: Date.now(),
              });
              next = { ...next, selectedChatModelId: cModelId };
            }

            // 写入两个新 store 的 localStorage（用于下次启动直接读取）
            if (apiKeys.length > 0) {
              localStorage.setItem(
                'app-api-keys-storage',
                JSON.stringify({ state: { keys: apiKeys }, version: 1 })
              );
            }
            if (models.length > 0) {
              localStorage.setItem(
                'app-custom-models-storage',
                JSON.stringify({ state: { models }, version: 1 })
              );
            }
          } catch (e) {
            console.warn('[configStore migrate v13] failed:', e);
          }
        }

        return next;
      },
    }
  )
);

// 自愈 migrate：由 onRehydrateStorage 延迟触发，避免与两个新 store 的循环依赖
async function selfHealMigrate(state: any) {
  try {
    const { useApiKeyStore } = await import('./apiKeyStore');
    const { useModelStore } = await import('./modelStore');
    const apiKeys = useApiKeyStore.getState().keys;
    const models = useModelStore.getState().models;
    const hasLegacyImage = !!state.imageApiKey && !!state.imageApiBaseUrl;
    const hasLegacyVision = !!state.visionApiKey && !!state.visionApiBaseUrl;
    const hasLegacyChat = !!state.chatApiKey && !!state.chatApiBaseUrl;
    const hasAnyLegacy = hasLegacyImage || hasLegacyVision || hasLegacyChat;
    if (!(apiKeys.length === 0 && models.length === 0 && hasAnyLegacy)) return;

    const genId = (prefix: string) =>
      `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const newKeys: any[] = [];
    const newModels: any[] = [];

    if (hasLegacyImage) {
      const imgKeyId = genId('key');
      newKeys.push({
        id: imgKeyId,
        name: state.imageProvider === 'gemini' ? 'Gemini 生图' : 'OpenAI 生图',
        provider: state.imageProvider || 'gemini',
        apiBaseUrl: state.imageApiBaseUrl,
        apiKey: state.imageApiKey,
        createdAt: Date.now(),
      });
      const imgModelId = genId('model');
      newModels.push({
        id: imgModelId,
        name: state.imageModel || 'gemini-3.1-flash-image-preview',
        apiKeyId: imgKeyId,
        purpose: 'image',
        createdAt: Date.now(),
      });
      useConfigStore.setState({ selectedImageModelId: imgModelId });

      try {
        const oldCustom = JSON.parse(localStorage.getItem('banana-custom-models') || '[]');
        if (Array.isArray(oldCustom)) {
          for (const name of oldCustom) {
            if (typeof name === 'string' && name.trim()) {
              newModels.push({
                id: genId('model'),
                name: name.trim(),
                apiKeyId: imgKeyId,
                purpose: 'image',
                createdAt: Date.now(),
              });
            }
          }
        }
      } catch {}
    }

    if (hasLegacyVision) {
      const vKeyId = genId('key');
      newKeys.push({
        id: vKeyId,
        name: state.visionProvider === 'gemini-chat' ? 'Gemini 识图' : 'OpenAI 识图',
        provider: state.visionProvider || 'gemini-chat',
        apiBaseUrl: state.visionApiBaseUrl,
        apiKey: state.visionApiKey,
        createdAt: Date.now(),
      });
      const vModelId = genId('model');
      newModels.push({
        id: vModelId,
        name: state.visionModel || 'gemini-3-flash-preview',
        apiKeyId: vKeyId,
        purpose: 'vision',
        createdAt: Date.now(),
      });
      useConfigStore.setState({ selectedVisionModelId: vModelId });
    }

    if (hasLegacyChat) {
      const cKeyId = genId('key');
      newKeys.push({
        id: cKeyId,
        name: state.chatProvider === 'gemini-chat' ? 'Gemini 对话' : 'OpenAI 对话',
        provider: state.chatProvider || 'openai-chat',
        apiBaseUrl: state.chatApiBaseUrl,
        apiKey: state.chatApiKey,
        createdAt: Date.now(),
      });
      const cModelId = genId('model');
      newModels.push({
        id: cModelId,
        name: state.chatModel || 'gemini-3-flash-preview',
        apiKeyId: cKeyId,
        purpose: 'chat',
        createdAt: Date.now(),
      });
      useConfigStore.setState({ selectedChatModelId: cModelId });
    }

    if (newKeys.length > 0) useApiKeyStore.setState({ keys: newKeys });
    if (newModels.length > 0) useModelStore.setState({ models: newModels });
    console.log('[configStore] self-heal imported', newKeys.length, 'keys and', newModels.length, 'models');
  } catch (e) {
    console.warn('[configStore] self-heal failed:', e);
  }
}
