import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ModelPurpose = 'image' | 'vision' | 'chat';

export interface CustomModel {
  id: string;
  name: string;             // API 参数用的模型名，如 "gpt-image-2"
  displayName?: string;     // 展示名，可选，空则用 name
  apiKeyId: string;         // 绑定到 apiKeyStore 里的某把 key
  purpose: ModelPurpose;    // 用途
  createdAt: number;
}

interface ModelState {
  models: CustomModel[];
  addModel: (input: Omit<CustomModel, 'id' | 'createdAt'>) => CustomModel;
  updateModel: (id: string, patch: Partial<Omit<CustomModel, 'id' | 'createdAt'>>) => void;
  removeModel: (id: string) => void;
  getModel: (id: string) => CustomModel | undefined;
  getByPurpose: (purpose: ModelPurpose) => CustomModel[];
  getByName: (name: string, purpose?: ModelPurpose) => CustomModel | undefined;
}

const genId = () => `model_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: [],
      addModel: (input) => {
        const entry: CustomModel = { ...input, id: genId(), createdAt: Date.now() };
        set((s) => ({ models: [...s.models, entry] }));
        return entry;
      },
      updateModel: (id, patch) => {
        set((s) => ({
          models: s.models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        }));
      },
      removeModel: (id) => {
        set((s) => ({ models: s.models.filter((m) => m.id !== id) }));
      },
      getModel: (id) => get().models.find((m) => m.id === id),
      getByPurpose: (purpose) => get().models.filter((m) => m.purpose === purpose),
      getByName: (name, purpose) =>
        get().models.find(
          (m) => m.name === name && (purpose ? m.purpose === purpose : true)
        ),
    }),
    {
      name: 'app-custom-models-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);

export const PURPOSE_LABEL: Record<ModelPurpose, string> = {
  image: '图像生成',
  vision: '识图（反向提示词）',
  chat: '对话（提示词优化）',
};
