import React, { useState } from 'react';
import { Key, Box, HardDrive, Globe, Info, Eye, EyeOff, Zap, Save, Loader2, X } from 'lucide-react';
import logoImg from '@/assets/logo.png';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { useConfigStore, IMAGE_MODEL_OPTIONS, CUSTOM_MODEL_VALUE } from '@/store/configStore';
import { getProviders, updateProviderConfig, type ProviderConfig } from '@/services/providerApi';
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

function FieldInput({ type = 'text', value, onChange, placeholder, mono, secret }: {
  type?: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={secret && !show ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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

function ApiConfigSection() {
  const { t } = useTranslation();
  const {
    imageProvider, imageApiBaseUrl, imageApiKey, imageModel, imageTimeoutSeconds,
    setImageProvider, setImageApiBaseUrl, setImageApiKey, setImageModel, setImageTimeoutSeconds,
    chatProvider, chatApiBaseUrl, chatApiKey, chatModel, chatTimeoutSeconds,
    setChatProvider, setChatApiBaseUrl, setChatApiKey, setChatModel, setChatTimeoutSeconds,
    setChatSyncedConfig,
  } = useConfigStore(useShallow((s) => ({
    imageProvider: s.imageProvider, imageApiBaseUrl: s.imageApiBaseUrl, imageApiKey: s.imageApiKey,
    imageModel: s.imageModel, imageTimeoutSeconds: s.imageTimeoutSeconds,
    setImageProvider: s.setImageProvider, setImageApiBaseUrl: s.setImageApiBaseUrl,
    setImageApiKey: s.setImageApiKey, setImageModel: s.setImageModel, setImageTimeoutSeconds: s.setImageTimeoutSeconds,
    chatProvider: s.chatProvider, chatApiBaseUrl: s.chatApiBaseUrl, chatApiKey: s.chatApiKey,
    chatModel: s.chatModel, chatTimeoutSeconds: s.chatTimeoutSeconds,
    setChatProvider: s.setChatProvider, setChatApiBaseUrl: s.setChatApiBaseUrl,
    setChatApiKey: s.setChatApiKey, setChatModel: s.setChatModel, setChatTimeoutSeconds: s.setChatTimeoutSeconds,
    setChatSyncedConfig: s.setChatSyncedConfig,
  })));

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const syncConfigToBackend = async () => {
    try {
      // Sync image provider
      await updateProviderConfig({
        provider_name: imageProvider,
        display_name: imageProvider === 'gemini' ? 'Gemini' : 'OpenAI',
        api_base: imageApiBaseUrl,
        api_key: imageApiKey,
        enabled: true,
        model_id: imageModel,
        timeout_seconds: imageTimeoutSeconds,
      });
      // Sync chat provider
      if (chatApiKey) {
        await updateProviderConfig({
          provider_name: chatProvider,
          display_name: chatProvider === 'gemini-chat' ? 'Gemini Chat' : 'OpenAI Chat',
          api_base: chatApiBaseUrl,
          api_key: chatApiKey,
          enabled: true,
          model_id: chatModel,
          timeout_seconds: chatTimeoutSeconds,
        });
        // Update synced config
        setChatSyncedConfig({
          apiBaseUrl: chatApiBaseUrl,
          apiKey: chatApiKey,
          model: chatModel,
          timeoutSeconds: chatTimeoutSeconds,
        });
      }
      return true;
    } catch {
      return false;
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const synced = await syncConfigToBackend();
      if (synced) {
        setTestResult('success');
        toast.success(t('配置已保存并连接成功', '配置已保存并连接成功'));
      } else {
        setTestResult('error');
        toast.error(t('同步配置失败', '同步配置失败'));
      }
    } catch {
      setTestResult('error');
      toast.error(t('连接失败', '连接失败，请检查配置'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-fg-primary">{t('API 配置', 'API 配置')}</h3>
        <p className="text-sm text-fg-muted mt-1">{t('配置 AI 模型的 API 密钥和端点地址', '配置 AI 模型的 API 密钥和端点地址')}</p>
      </div>

      {/* Image Generation API */}
      <div className="bg-surface-secondary border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-2.5 h-2.5 rounded-full', imageApiKey ? 'bg-success' : 'bg-fg-muted')} />
          <h4 className="text-[15px] font-semibold text-fg-primary">{t('图像生成 API', '图像生成 API')}</h4>
          <span className={cn('text-[11px] px-2 py-0.5 rounded-full', imageApiKey ? 'bg-success/15 text-success' : 'bg-surface-tertiary text-fg-muted')}>
            {imageApiKey ? t('已配置', '已配置') : t('未配置', '未配置')}
          </span>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <FieldLabel>Provider</FieldLabel>
            <select
              value={imageProvider}
              onChange={(e) => setImageProvider(e.target.value)}
              className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>API Key</FieldLabel>
            <FieldInput value={imageApiKey} onChange={setImageApiKey} placeholder="输入 API Key..." secret />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>API Base URL</FieldLabel>
            <FieldInput value={imageApiBaseUrl} onChange={setImageApiBaseUrl} placeholder="https://generativelanguage.googleapis.com" mono />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>{t('超时时间（秒）', '超时时间（秒）')}</FieldLabel>
            <FieldInput value={String(imageTimeoutSeconds)} onChange={(v) => setImageTimeoutSeconds(Number(v) || 500)} placeholder="500" mono />
          </div>
          <button
            onClick={testConnection}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-tertiary border border-border text-xs font-medium text-fg-secondary hover:text-fg-primary transition-colors"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {t('保存并测试连接', '保存并测试连接')}
          </button>
        </div>
      </div>

      {/* Chat/Prompt Optimization API */}
      <div className="bg-surface-secondary border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-2.5 h-2.5 rounded-full', chatApiKey ? 'bg-success' : 'bg-fg-muted')} />
          <h4 className="text-[15px] font-semibold text-fg-primary">{t('提示词优化 API', '提示词优化 API')}</h4>
          <span className={cn('text-[11px] px-2 py-0.5 rounded-full', chatApiKey ? 'bg-success/15 text-success' : 'bg-surface-tertiary text-fg-muted')}>
            {chatApiKey ? t('已配置', '已配置') : t('未配置', '未配置')}
          </span>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <FieldLabel>Provider</FieldLabel>
            <select
              value={chatProvider}
              onChange={(e) => setChatProvider(e.target.value)}
              className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
            >
              <option value="gemini-chat">Gemini (/v1beta)</option>
              <option value="openai-chat">OpenAI (/v1)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel>API Key</FieldLabel>
            <FieldInput value={chatApiKey} onChange={setChatApiKey} placeholder="输入 API Key..." secret />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>API Base URL</FieldLabel>
            <FieldInput value={chatApiBaseUrl} onChange={setChatApiBaseUrl} placeholder="https://api.openai.com/v1" mono />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>{t('模型', '模型')}</FieldLabel>
            <FieldInput value={chatModel} onChange={setChatModel} placeholder="gemini-3-flash-preview" mono />
          </div>
        </div>
      </div>
    </div>
  );
}

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

function ModelManageSection() {
  const { t } = useTranslation();
  const { imageModel, setImageModel } = useConfigStore(
    useShallow((s) => ({ imageModel: s.imageModel, setImageModel: s.setImageModel }))
  );
  const STORAGE_KEY = 'banana-custom-models';
  const [customModels, setCustomModels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  });
  const [inputVal, setInputVal] = useState('');

  const addModel = () => {
    const val = inputVal.trim();
    if (!val) { toast.error('请输入模型名称'); return; }
    if (IMAGE_MODEL_OPTIONS.some((o) => o.value === val) || customModels.includes(val)) {
      toast.error('模型已存在'); return;
    }
    const next = [...customModels, val];
    setCustomModels(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setInputVal('');
    toast.success(`已添加模型: ${val}`);
  };

  const removeModel = (model: string) => {
    const next = customModels.filter((m) => m !== model);
    setCustomModels(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (imageModel === model) setImageModel(IMAGE_MODEL_OPTIONS[0].value);
    toast.success('已移除');
  };

  const allModels = [
    ...IMAGE_MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label, builtin: true })),
    ...customModels.map((m) => ({ value: m, label: m, builtin: false })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-fg-primary">{t('模型管理', '模型管理')}</h3>
        <p className="text-sm text-fg-muted mt-1">{t('管理可用的 AI 模型', '管理可用的 AI 模型')}</p>
      </div>
      <div className="bg-surface-secondary border border-border rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-semibold text-fg-primary">{t('图像生成模型', '图像生成模型')}</h4>
        <div className="space-y-2">
          {allModels.map((opt) => (
            <div
              key={opt.value}
              className={cn(
                'flex items-center justify-between px-4 py-3 rounded-xl transition-colors',
                imageModel === opt.value ? 'bg-primary/15 ring-1 ring-primary' : 'bg-surface-tertiary'
              )}
            >
              <button onClick={() => setImageModel(opt.value)} className="flex-1 text-left">
                <p className={cn('text-sm font-medium', imageModel === opt.value ? 'text-primary' : 'text-fg-primary')}>{opt.label}</p>
                {opt.builtin && <p className="text-xs text-fg-muted font-mono mt-0.5">{opt.value}</p>}
              </button>
              <div className="flex items-center gap-2">
                {imageModel === opt.value && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">{t('当前', '当前')}</span>
                )}
                {!opt.builtin && (
                  <button onClick={() => removeModel(opt.value)} className="text-fg-muted hover:text-error transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-fg-secondary">{t('添加自定义模型', '添加自定义模型')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="输入模型名称，如 gemini-2.5-flash-image..."
              className="flex-1 bg-surface-tertiary border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-fg-primary font-mono placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
              onKeyDown={(e) => { if (e.key === 'Enter') addModel(); }}
            />
            <button
              onClick={addModel}
              className="px-3.5 py-2.5 rounded-[10px] bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
            >
              {t('添加', '添加')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AboutSection() {
  const { t } = useTranslation();
  const { user, accessInfo, logout } = useAuthStore();

  const isTrial = accessInfo?.access_reason === 'trial';
  const isSubscribed = accessInfo?.access_reason === 'subscription';

  const goToSubscription = () => {
    import('@/store/navigationStore').then(({ useNavigationStore }) => {
      useNavigationStore.getState().setPage('subscription');
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-fg-primary">{t('settingsPage.aboutTitle')}</h3>
        <p className="text-sm text-fg-muted mt-1">{t('settingsPage.aboutDesc')}</p>
      </div>

      {/* 账号信息 */}
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
          {/* 续费/订阅按钮 → 跳转独立订阅页 */}
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

      {/* 应用信息 */}
      <div className="bg-surface-secondary border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <img src={logoImg} alt="logo" className="w-12 h-12 rounded-xl" />
          <div>
            <h4 className="text-base font-semibold text-fg-primary">{t('sidebar.appName')}</h4>
            <p className="text-xs text-fg-muted">v2.7.4</p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-fg-secondary">
          <p>{t('onboarding.appDesc')}</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('api');

  const tabContent: Record<SettingsTab, React.ReactNode> = {
    api: <ApiConfigSection />,
    models: <ModelManageSection />,
    language: <LanguageSection />,
    about: <AboutSection />,
  };

  return (
    <div className="flex flex-1 overflow-hidden p-8 gap-8">
      {/* Left tabs */}
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

      {/* Right content */}
      <div className="flex-1 overflow-y-auto max-w-2xl scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {tabContent[activeTab]}
      </div>
    </div>
  );
}
