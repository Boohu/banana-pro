import { useConfigStore } from '@/store/configStore';
import { useModelStore, type ModelPurpose } from '@/store/modelStore';
import { useApiKeyStore, type ApiKeyProvider } from '@/store/apiKeyStore';
import { updateProviderConfig } from '@/services/providerApi';

export interface ResolvedModel {
  provider: ApiKeyProvider;
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds: number;
  source: 'store' | 'legacy';
}

// 把 chat 变体 provider 映射到对应的生图 provider 名
// 后端 image provider 只有 openai / gemini 两种
function normalizeImageProvider(p: ApiKeyProvider): 'openai' | 'gemini' {
  if (p === 'gemini' || p === 'gemini-chat') return 'gemini';
  return 'openai';
}

export function resolveActiveModel(purpose: ModelPurpose): ResolvedModel | null {
  const config = useConfigStore.getState();
  const models = useModelStore.getState();
  const keys = useApiKeyStore.getState();

  const selectedId =
    purpose === 'image' ? config.selectedImageModelId
    : purpose === 'vision' ? config.selectedVisionModelId
    : config.selectedChatModelId;

  if (selectedId) {
    const m = models.getModel(selectedId);
    if (m) {
      const k = keys.getKey(m.apiKeyId);
      if (k) {
        const timeout =
          purpose === 'image' ? config.imageTimeoutSeconds
          : purpose === 'vision' ? config.visionTimeoutSeconds
          : config.chatTimeoutSeconds;
        return {
          provider: k.provider,
          apiBaseUrl: k.apiBaseUrl,
          apiKey: k.apiKey,
          modelName: m.name,
          timeoutSeconds: timeout || 150,
          source: 'store',
        };
      }
    }
  }

  // fallback 到旧扁平字段（兼容尚未迁移的数据）
  if (purpose === 'image' && config.imageApiKey) {
    return {
      provider: (config.imageProvider as ApiKeyProvider) || 'gemini',
      apiBaseUrl: config.imageApiBaseUrl,
      apiKey: config.imageApiKey,
      modelName: config.imageModel,
      timeoutSeconds: config.imageTimeoutSeconds || 500,
      source: 'legacy',
    };
  }
  if (purpose === 'vision' && config.visionApiKey) {
    return {
      provider: (config.visionProvider as ApiKeyProvider) || 'gemini-chat',
      apiBaseUrl: config.visionApiBaseUrl,
      apiKey: config.visionApiKey,
      modelName: config.visionModel,
      timeoutSeconds: config.visionTimeoutSeconds || 150,
      source: 'legacy',
    };
  }
  if (purpose === 'chat' && config.chatApiKey) {
    return {
      provider: (config.chatProvider as ApiKeyProvider) || 'openai-chat',
      apiBaseUrl: config.chatApiBaseUrl,
      apiKey: config.chatApiKey,
      modelName: config.chatModel,
      timeoutSeconds: config.chatTimeoutSeconds || 150,
      source: 'legacy',
    };
  }

  return null;
}

// 生成请求前把活跃模型的 key/base 同步到后端 ProviderConfig
// 返回用于请求的 provider 名（后端 provider）和 model_id
export async function syncActiveModelToBackend(purpose: ModelPurpose): Promise<{
  provider: string;
  modelId: string;
} | null> {
  const resolved = resolveActiveModel(purpose);
  if (!resolved) return null;

  // image 用途：后端 provider 只有 openai / gemini
  // vision / chat 用途：可能是 openai-chat / gemini-chat
  const backendProvider = purpose === 'image'
    ? normalizeImageProvider(resolved.provider)
    : resolved.provider;

  const displayName =
    backendProvider === 'gemini' ? 'Gemini'
    : backendProvider === 'openai' ? 'OpenAI'
    : backendProvider === 'gemini-chat' ? 'Gemini Chat'
    : 'OpenAI Chat';

  try {
    await updateProviderConfig({
      provider_name: backendProvider,
      display_name: displayName,
      api_base: resolved.apiBaseUrl,
      api_key: resolved.apiKey,
      enabled: true,
      model_id: resolved.modelName,
      timeout_seconds: resolved.timeoutSeconds,
    });
  } catch (err) {
    console.warn('[syncActiveModelToBackend] update failed:', err);
    // 不阻塞：即使同步失败，后端可能仍有可用的旧配置
  }

  return { provider: backendProvider, modelId: resolved.modelName };
}
