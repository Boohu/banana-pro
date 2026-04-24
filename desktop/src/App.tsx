import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/Layout/AppLayout';
import { ToastContainer } from './components/common/Toast';
import { OnboardingOverlay } from './components/Onboarding/OnboardingOverlay';
import { LoginPage } from './pages/LoginPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { useAuthStore } from './store/authStore';
import i18n from './i18n';
import { useConfigStore } from './store/configStore';
import { Loader2, Download, X } from 'lucide-react';

const ONBOARDING_KEY = 'banana-onboarding-done';
const queryClient = new QueryClient();

// 检查桌面端自动更新
async function checkForUpdate(): Promise<{ available: boolean; version?: string; notes?: string; doUpdate?: () => Promise<void> }> {
  const isTauri = Boolean((window as any).__TAURI_INTERNALS__);
  if (!isTauri) return { available: false };

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update) {
      return {
        available: true,
        version: update.version,
        notes: update.body || '',
        doUpdate: async () => {
          await update.downloadAndInstall();
          // 安装完成后重启
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        },
      };
    }
  } catch (err) {
    console.log('[Update] 检查更新失败:', err);
  }
  return { available: false };
}

function App() {
  const language = useConfigStore((s) => s.language);
  const apiKey = useConfigStore((s) => s.imageApiKey);
  const { isAuthenticated, hasAccess, isLoading, checkAuth } = useAuthStore();

  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem(ONBOARDING_KEY) && !apiKey;
  });

  // 自动更新状态
  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes: string; doUpdate: () => Promise<void> } | null>(null);
  const [updating, setUpdating] = useState(false);

  // 启动时检查登录状态 + 定时重新校验（5分钟，保证单设备登录及时踢掉旧设备）
  useEffect(() => {
    checkAuth();
    const interval = setInterval(() => {
      checkAuth(true);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkAuth]);

  // 启动时检查更新（延迟 3 秒，不影响首屏）
  useEffect(() => {
    const timer = setTimeout(async () => {
      const result = await checkForUpdate();
      if (result.available && result.doUpdate) {
        setUpdateInfo({ version: result.version!, notes: result.notes!, doUpdate: result.doUpdate });
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // 手动检查更新：SettingsPage 按钮通过 CustomEvent 触发，结果走自定义弹窗（和启动时一致）
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      try {
        const result = await checkForUpdate();
        if (result.available && result.doUpdate) {
          setUpdateInfo({ version: result.version!, notes: result.notes!, doUpdate: result.doUpdate });
        }
        detail.onResult?.({ available: result.available, version: result.version });
      } catch (err) {
        detail.onError?.(err instanceof Error ? err.message : String(err));
      }
    };
    window.addEventListener('check-update:manual', handler);
    return () => window.removeEventListener('check-update:manual', handler);
  }, []);

  useEffect(() => {
    if (!language) return;
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language]);

  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setShowOnboarding(false);
  };

  // 加载中
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-primary">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // 未登录 → 登录页
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // 已登录但无权限（试用过期 + 未付费）→ 订阅页
  if (!hasAccess) {
    return <SubscriptionPage />;
  }

  // 正常使用
  return (
    <QueryClientProvider client={queryClient}>
      <AppLayout />
      <ToastContainer />
      {showOnboarding && <OnboardingOverlay onDismiss={dismissOnboarding} />}

      {/* 更新提示弹窗 */}
      {updateInfo && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-secondary rounded-2xl border border-border p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-fg-primary">发现新版本</h3>
              <button onClick={() => setUpdateInfo(null)} className="p-1 text-fg-muted hover:text-fg-primary rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-primary font-semibold mb-2">v{updateInfo.version}</p>
              {updateInfo.notes && (
                <p className="text-sm text-fg-secondary whitespace-pre-line leading-relaxed max-h-40 overflow-y-auto">{updateInfo.notes}</p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setUpdateInfo(null)}
                className="flex-1 py-2.5 rounded-lg border border-border text-fg-secondary text-sm font-medium hover:bg-surface-tertiary transition-colors"
              >
                稍后再说
              </button>
              <button
                onClick={async () => {
                  setUpdating(true);
                  try {
                    await updateInfo.doUpdate();
                  } catch (err) {
                    console.error('[Update] 更新失败:', err);
                    setUpdating(false);
                  }
                }}
                disabled={updating}
                className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {updating ? '更新中...' : '立即更新'}
              </button>
            </div>
          </div>
        </div>
      )}
    </QueryClientProvider>
  );
}

export default App;
