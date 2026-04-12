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
import { Loader2 } from 'lucide-react';

const ONBOARDING_KEY = 'banana-onboarding-done';
const queryClient = new QueryClient();

function App() {
  const language = useConfigStore((s) => s.language);
  const apiKey = useConfigStore((s) => s.imageApiKey);
  const { isAuthenticated, hasAccess, isLoading, checkAuth } = useAuthStore();

  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem(ONBOARDING_KEY) && !apiKey;
  });

  // 启动时检查登录状态
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

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
    </QueryClientProvider>
  );
}

export default App;
