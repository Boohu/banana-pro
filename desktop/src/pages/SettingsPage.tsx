import React, { useMemo, useState } from 'react';
import { Key, Box, Globe, Info, Eye, EyeOff, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import logoImg from '@/assets/logo.png';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/store/configStore';
import { useApiKeyStore, maskApiKey, PROVIDER_DEFAULT_BASE, PROVIDER_LABEL, type ApiKey, type ApiKeyProvider } from '@/store/apiKeyStore';
import { useModelStore, PURPOSE_LABEL, type CustomModel, type ModelPurpose } from '@/store/modelStore';
import { toast } from '@/store/toastStore';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import i18n from '@/i18n';

type SettingsTab = 'api' | 'models' | 'language' | 'about';

const tabKeys: { id: SettingsTab; icon: React.ElementType; labelKey: string }[] = [
  { id: 'api', icon: Key, labelKey: 'settingsPage.apiConfig' },
  { id: 'models', icon: Box, labelKey: 'settingsPage.modelManage' },
  { id: 'language', icon: Globe, labelKey: 'settingsPage.appearance' },
  { id: 'about', icon: Info, labelKey: 'settingsPage.about' },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-fg-secondary">{children}</label>;
}

function FieldInput({ type = 'text', value, onChange, placeholder, mono, secret, autoFocus }: {
  type?: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; secret?: boolean; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={secret && !show ? 'password' : type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn(
          'w-full bg-surface-tertiary border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-fg-primary outline-none focus:border-primary transition-colors',
          mono && 'font-mono',
          secret && 'pr-10'
        )}
      />
      {secret && (
        <button onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-secondary">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

// ============ API 密钥管理 ============

function ApiKeyDialog({ editKey, onClose }: { editKey: ApiKey | null; onClose: () => void }) {
  const isEdit = !!editKey;
  const addKey = useApiKeyStore((s) => s.addKey);
  const updateKey = useApiKeyStore((s) => s.updateKey);
  const [name, setName] = useState(editKey?.name || '');
  const [provider, setProvider] = useState<ApiKeyProvider>(editKey?.provider || 'openai');
  const [apiBaseUrl, setApiBaseUrl] = useState(editKey?.apiBaseUrl || PROVIDER_DEFAULT_BASE['openai']);
  const [apiKey, setApiKey] = useState(editKey?.apiKey || '');

  // provider 切换时自动填默认 base URL（仅当 base 为空或是另一个默认值时）
  const handleProviderChange = (p: ApiKeyProvider) => {
    setProvider(p);
    const isCurrentDefault = Object.values(PROVIDER_DEFAULT_BASE).includes(apiBaseUrl.trim());
    if (!apiBaseUrl.trim() || isCurrentDefault) {
      setApiBaseUrl(PROVIDER_DEFAULT_BASE[p]);
    }
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    const trimmedBase = apiBaseUrl.trim();
    const trimmedKey = apiKey.trim();
    if (!trimmedName) { toast.error('请输入密钥名称'); return; }
    if (!trimmedBase) { toast.error('请输入 API Base URL'); return; }
    if (!trimmedKey) { toast.error('请输入 API Key'); return; }
    if (isEdit && editKey) {
      updateKey(editKey.id, { name: trimmedName, provider, apiBaseUrl: trimmedBase, apiKey: trimmedKey });
      toast.success('密钥已更新');
    } else {
      addKey({ name: trimmedName, provider, apiBaseUrl: trimmedBase, apiKey: trimmedKey });
      toast.success('密钥已添加');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-surface-secondary rounded-2xl w-[480px] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-fg-primary">{isEdit ? '编辑密钥' : '添加密钥'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center text-fg-secondary hover:text-fg-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel>密钥名称</FieldLabel>
            <FieldInput value={name} onChange={setName} placeholder="如：云雾主账户" autoFocus />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Provider 类型</FieldLabel>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as ApiKeyProvider)}
              className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
            >
              <option value="openai">{PROVIDER_LABEL['openai']}</option>
              <option value="gemini">{PROVIDER_LABEL['gemini']}</option>
              <option value="openai-chat">{PROVIDER_LABEL['openai-chat']}</option>
              <option value="gemini-chat">{PROVIDER_LABEL['gemini-chat']}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>API Base URL</FieldLabel>
            <FieldInput value={apiBaseUrl} onChange={setApiBaseUrl} placeholder="https://..." mono />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>API Key</FieldLabel>
            <FieldInput value={apiKey} onChange={setApiKey} placeholder="sk-..." secret mono />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-surface-tertiary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors">
            取消
          </button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ApiKeyCard({ k, onEdit, onRemove }: { k: ApiKey; onEdit: () => void; onRemove: () => void }) {
  const [showFull, setShowFull] = useState(false);
  return (
    <div className="bg-surface-tertiary border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-fg-primary truncate">{k.name}</h4>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
              {PROVIDER_LABEL[k.provider]}
            </span>
          </div>
          <p className="text-[11px] text-fg-muted font-mono mt-1 truncate">{k.apiBaseUrl}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <code className="text-[11px] text-fg-secondary font-mono">
              {showFull ? k.apiKey : maskApiKey(k.apiKey)}
            </code>
            <button onClick={() => setShowFull(!showFull)} className="text-fg-muted hover:text-fg-secondary">
              {showFull ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="w-7 h-7 rounded-md bg-surface-secondary flex items-center justify-center text-fg-muted hover:text-fg-primary transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} className="w-7 h-7 rounded-md bg-surface-secondary flex items-center justify-center text-fg-muted hover:text-error transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ApiKeyListSection() {
  const { t } = useTranslation();
  const keys = useApiKeyStore((s) => s.keys);
  const removeKey = useApiKeyStore((s) => s.removeKey);
  const modelsUsing = useModelStore((s) => s.models);
  const [dialogKey, setDialogKey] = useState<ApiKey | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleRemove = (id: string) => {
    const inUse = modelsUsing.filter((m) => m.apiKeyId === id);
    if (inUse.length > 0) {
      const modelNames = inUse.map((m) => m.name).join('、');
      if (!window.confirm(`该密钥被 ${inUse.length} 个模型使用（${modelNames}），删除后这些模型将无法使用。确定删除？`)) {
        return;
      }
    } else {
      if (!window.confirm('确定删除此密钥？')) return;
    }
    removeKey(id);
    toast.success('已删除');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-fg-primary">{t('API 密钥管理', 'API 密钥管理')}</h3>
          <p className="text-sm text-fg-muted mt-1">{t('添加多个 API 密钥，模型可按需绑定使用', '添加多个 API 密钥，模型可按需绑定使用')}</p>
        </div>
        <button
          onClick={() => { setDialogKey(null); setDialogOpen(true); }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          添加密钥
        </button>
      </div>

      {keys.length === 0 ? (
        <div className="bg-surface-secondary border border-dashed border-border rounded-2xl p-10 text-center space-y-3">
          <Key className="w-10 h-10 mx-auto text-fg-muted" />
          <p className="text-sm text-fg-secondary">还没有添加密钥</p>
          <button
            onClick={() => { setDialogKey(null); setDialogOpen(true); }}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            添加第一把密钥
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {keys.map((k) => (
            <ApiKeyCard
              key={k.id}
              k={k}
              onEdit={() => { setDialogKey(k); setDialogOpen(true); }}
              onRemove={() => handleRemove(k.id)}
            />
          ))}
        </div>
      )}

      {dialogOpen && (
        <ApiKeyDialog editKey={dialogKey} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

// ============ 模型管理 ============

function ModelDialog({ editModel, onClose }: { editModel: CustomModel | null; onClose: () => void }) {
  const isEdit = !!editModel;
  const addModel = useModelStore((s) => s.addModel);
  const updateModel = useModelStore((s) => s.updateModel);
  const keys = useApiKeyStore((s) => s.keys);
  const [name, setName] = useState(editModel?.name || '');
  const [displayName, setDisplayName] = useState(editModel?.displayName || '');
  const [purpose, setPurpose] = useState<ModelPurpose>(editModel?.purpose || 'image');
  const [apiKeyId, setApiKeyId] = useState(editModel?.apiKeyId || keys[0]?.id || '');

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) { toast.error('请输入模型名称'); return; }
    if (!apiKeyId) { toast.error('请选择绑定的密钥'); return; }
    if (isEdit && editModel) {
      updateModel(editModel.id, { name: trimmedName, displayName: displayName.trim() || undefined, apiKeyId, purpose });
      toast.success('模型已更新');
    } else {
      addModel({ name: trimmedName, displayName: displayName.trim() || undefined, apiKeyId, purpose });
      toast.success('模型已添加');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-surface-secondary rounded-2xl w-[480px] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-fg-primary">{isEdit ? '编辑模型' : '添加模型'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center text-fg-secondary hover:text-fg-primary">
            <X className="w-4 h-4" />
          </button>
        </div>
        {keys.length === 0 ? (
          <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-sm text-warning">
            请先在「API 密钥管理」添加一把密钥，再来添加模型。
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <FieldLabel>模型名称（API 参数）</FieldLabel>
                <FieldInput value={name} onChange={setName} placeholder="如：gpt-image-2" mono autoFocus />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>展示名（可选）</FieldLabel>
                <FieldInput value={displayName} onChange={setDisplayName} placeholder="如：GPT Image 2（按量）" />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>用途</FieldLabel>
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as ModelPurpose)}
                  className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
                >
                  <option value="image">{PURPOSE_LABEL['image']}</option>
                  <option value="vision">{PURPOSE_LABEL['vision']}</option>
                  <option value="chat">{PURPOSE_LABEL['chat']}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>绑定密钥</FieldLabel>
                <select
                  value={apiKeyId}
                  onChange={(e) => setApiKeyId(e.target.value)}
                  className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
                >
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}（{PROVIDER_LABEL[k.provider]}）</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-surface-tertiary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors">
                取消
              </button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                保存
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModelListSection() {
  const { t } = useTranslation();
  const models = useModelStore((s) => s.models);
  const removeModel = useModelStore((s) => s.removeModel);
  const keys = useApiKeyStore((s) => s.keys);
  const { selectedImageModelId, selectedVisionModelId, selectedChatModelId, setSelectedImageModelId, setSelectedVisionModelId, setSelectedChatModelId } =
    useConfigStore(useShallow((s) => ({
      selectedImageModelId: s.selectedImageModelId,
      selectedVisionModelId: s.selectedVisionModelId,
      selectedChatModelId: s.selectedChatModelId,
      setSelectedImageModelId: s.setSelectedImageModelId,
      setSelectedVisionModelId: s.setSelectedVisionModelId,
      setSelectedChatModelId: s.setSelectedChatModelId,
    })));
  const [dialogModel, setDialogModel] = useState<CustomModel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activePurpose, setActivePurpose] = useState<ModelPurpose>('image');

  const filteredModels = useMemo(() => models.filter((m) => m.purpose === activePurpose), [models, activePurpose]);
  const keyMap = useMemo(() => new Map(keys.map((k) => [k.id, k])), [keys]);

  const selectedMap: Record<ModelPurpose, string | null> = {
    image: selectedImageModelId,
    vision: selectedVisionModelId,
    chat: selectedChatModelId,
  };
  const setSelectedByPurpose = (p: ModelPurpose, id: string) => {
    if (p === 'image') setSelectedImageModelId(id);
    else if (p === 'vision') setSelectedVisionModelId(id);
    else setSelectedChatModelId(id);
  };

  const handleRemove = (m: CustomModel) => {
    if (!window.confirm(`确定删除模型「${m.displayName || m.name}」？`)) return;
    removeModel(m.id);
    // 如果删的是当前选中的，清空
    if (selectedMap[m.purpose] === m.id) setSelectedByPurpose(m.purpose, '');
    toast.success('已删除');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-fg-primary">{t('模型管理', '模型管理')}</h3>
          <p className="text-sm text-fg-muted mt-1">{t('添加模型并绑定密钥，生成页从这里选择', '添加模型并绑定密钥，生成页从这里选择')}</p>
        </div>
        <button
          onClick={() => { setDialogModel(null); setDialogOpen(true); }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          添加模型
        </button>
      </div>

      {/* 用途 tab */}
      <div className="flex gap-2">
        {(['image', 'vision', 'chat'] as ModelPurpose[]).map((p) => (
          <button
            key={p}
            onClick={() => setActivePurpose(p)}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors',
              activePurpose === p
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-secondary text-fg-secondary hover:text-fg-primary'
            )}
          >
            {PURPOSE_LABEL[p]}（{models.filter((m) => m.purpose === p).length}）
          </button>
        ))}
      </div>

      {filteredModels.length === 0 ? (
        <div className="bg-surface-secondary border border-dashed border-border rounded-2xl p-10 text-center space-y-3">
          <Box className="w-10 h-10 mx-auto text-fg-muted" />
          <p className="text-sm text-fg-secondary">还没有{PURPOSE_LABEL[activePurpose]}的模型</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredModels.map((m) => {
            const k = keyMap.get(m.apiKeyId);
            const isSelected = selectedMap[m.purpose] === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  'flex items-center justify-between px-4 py-3 rounded-xl transition-colors group',
                  isSelected ? 'bg-primary/15 ring-1 ring-primary' : 'bg-surface-tertiary'
                )}
              >
                <button
                  onClick={() => setSelectedByPurpose(m.purpose, m.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-2">
                    <p className={cn('text-sm font-medium truncate', isSelected ? 'text-primary' : 'text-fg-primary')}>
                      {m.displayName || m.name}
                    </p>
                    {isSelected && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary shrink-0 flex items-center gap-0.5">
                        <Check className="w-3 h-3" />当前
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-fg-muted font-mono mt-0.5 truncate">
                    {m.name}{m.displayName && m.displayName !== m.name ? '' : ''}
                    {k ? ` · ${k.name}` : ' · 密钥不存在'}
                  </p>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); setDialogModel(m); setDialogOpen(true); }} className="w-7 h-7 rounded-md bg-surface-secondary flex items-center justify-center text-fg-muted hover:text-fg-primary transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleRemove(m); }} className="w-7 h-7 rounded-md bg-surface-secondary flex items-center justify-center text-fg-muted hover:text-error transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialogOpen && (
        <ModelDialog editModel={dialogModel} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

// ============ 语言 / 关于（保留原样） ============

function LanguageSection() {
  const { t } = useTranslation();
  const { language, setLanguage, setLanguageResolved } = useConfigStore(
    useShallow((s) => ({ language: s.language, setLanguage: s.setLanguage, setLanguageResolved: s.setLanguageResolved }))
  );

  const languages = [
    { value: 'system', label: t('跟随系统', '跟随系统') },
    { value: 'zh-CN', label: '简体中文' },
    { value: 'en-US', label: 'English' },
    { value: 'ja-JP', label: '日本語' },
    { value: 'ko-KR', label: '한국어' },
  ];

  const handleChange = (lang: string) => {
    setLanguage(lang);
    if (lang === 'system') {
      const resolved = navigator.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
      setLanguageResolved(resolved);
      void i18n.changeLanguage(resolved);
    } else {
      setLanguageResolved(lang);
      void i18n.changeLanguage(lang);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-fg-primary">{t('语言与外观', '语言与外观')}</h3>
        <p className="text-sm text-fg-muted mt-1">{t('界面语言和显示设置', '界面语言和显示设置')}</p>
      </div>
      <div className="bg-surface-secondary border border-border rounded-2xl p-5 space-y-4">
        <FieldLabel>{t('界面语言', '界面语言')}</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {languages.map((lang) => (
            <button
              key={lang.value}
              onClick={() => handleChange(lang.value)}
              className={cn(
                'px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
                language === lang.value
                  ? 'bg-primary/15 text-primary border border-primary'
                  : 'bg-surface-tertiary text-fg-secondary hover:text-fg-primary'
              )}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AboutSection() {
  const { t } = useTranslation();
  const { user, accessInfo, logout } = useAuthStore();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');

  const isTrial = accessInfo?.access_reason === 'trial';
  const isSubscribed = accessInfo?.access_reason === 'subscription';
  const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

  const goToSubscription = () => {
    import('@/store/navigationStore').then(({ useNavigationStore }) => {
      useNavigationStore.getState().setPage('subscription');
    });
  };

  const handleCheckUpdate = () => {
    if (!isTauri) return;
    setCheckingUpdate(true);
    setUpdateStatus('');
    // 交给 App.tsx 统一处理：若有新版本会弹出自定义弹窗（和启动时自动检查一致）
    window.dispatchEvent(new CustomEvent('check-update:manual', {
      detail: {
        onResult: (r: { available: boolean; version?: string }) => {
          setCheckingUpdate(false);
          if (r.available) {
            setUpdateStatus(`发现新版本 v${r.version}`);
          } else {
            setUpdateStatus('已是最新版本');
          }
        },
        onError: (msg: string) => {
          setCheckingUpdate(false);
          setUpdateStatus('检查失败：' + (msg || '未知错误'));
        },
      },
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-fg-primary">{t('settingsPage.aboutTitle')}</h3>
        <p className="text-sm text-fg-muted mt-1">{t('settingsPage.aboutDesc')}</p>
      </div>

      {user && (
        <div className="bg-surface-secondary border border-border rounded-2xl p-5 space-y-3">
          <h4 className="text-sm font-semibold text-fg-primary">{t('settingsPage.accountInfo')}</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-fg-muted">{t('settingsPage.nickname')}</span>
              <span className="text-fg-primary">{user.nickname}</span>
            </div>
            {user.email && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('settingsPage.email')}</span>
                <span className="text-fg-primary">{user.email}</span>
              </div>
            )}
            {user.phone && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('settingsPage.phone')}</span>
                <span className="text-fg-primary">{user.phone}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-fg-muted">{t('settingsPage.status')}</span>
              <span className={accessInfo?.has_access ? 'text-success' : 'text-error'}>
                {isTrial
                  ? t('settingsPage.trialStatus', { days: accessInfo.days_left })
                  : isSubscribed
                    ? t('settingsPage.subscriptionStatus', {
                        plan: accessInfo.subscription?.plan === 'yearly' ? t('settingsPage.yearlyPlan') : accessInfo.subscription?.plan === 'quarterly' ? t('settingsPage.quarterlyPlan') : t('settingsPage.monthlyPlan'),
                        days: accessInfo.days_left,
                      })
                    : t('settingsPage.expired')}
              </span>
            </div>
          </div>
          {isSubscribed ? (
            <div className="mt-2 space-y-1">
              <button
                onClick={goToSubscription}
                className="w-full py-2 rounded-lg bg-primary/15 text-primary text-sm font-semibold hover:bg-primary/25 transition-colors"
              >
                {t('settingsPage.renew')}
              </button>
              {accessInfo.subscription?.expires_at && (
                <p className="text-xs text-fg-muted text-center">
                  {t('settingsPage.expiresAt', { date: new Date(accessInfo.subscription.expires_at).toLocaleDateString() })}
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={goToSubscription}
              className="w-full mt-2 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              {t('settingsPage.subscribeNow')}
            </button>
          )}
          <button
            onClick={logout}
            className="w-full mt-2 py-2 rounded-lg bg-error/10 text-error text-sm font-medium hover:bg-error/20 transition-colors"
          >
            {t('settingsPage.logout')}
          </button>
        </div>
      )}

      <div className="bg-surface-secondary border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <img src={logoImg} alt="logo" className="w-12 h-12 rounded-xl" />
          <div>
            <h4 className="text-base font-semibold text-fg-primary">{t('sidebar.appName')}</h4>
            <p className="text-xs text-fg-muted">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.9.11'}</p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-fg-secondary">
          <p>{t('onboarding.appDesc')}</p>
        </div>
        {isTauri && (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleCheckUpdate}
              disabled={checkingUpdate}
              className="px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors"
            >
              {checkingUpdate ? '检查中...' : '检查更新'}
            </button>
            {updateStatus && <span className="text-xs text-fg-muted">{updateStatus}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('api');

  const tabContent: Record<SettingsTab, React.ReactNode> = {
    api: <ApiKeyListSection />,
    models: <ModelListSection />,
    language: <LanguageSection />,
    about: <AboutSection />,
  };

  return (
    <div className="flex flex-1 overflow-hidden p-8 gap-8">
      <div className="w-52 shrink-0 space-y-2">
        <h2 className="text-xl font-bold text-fg-primary mb-4">{t('settingsPage.title')}</h2>
        {tabKeys.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm transition-colors text-left',
                isActive ? 'bg-primary/15 text-primary font-medium' : 'text-fg-secondary hover:text-fg-primary hover:bg-surface-tertiary'
              )}
            >
              <Icon className={cn('w-4 h-4', isActive ? 'text-primary' : 'text-fg-muted')} />
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        <div className="max-w-3xl">
          {tabContent[activeTab]}
        </div>
      </div>
    </div>
  );
}
