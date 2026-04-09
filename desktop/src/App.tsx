import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/Layout/AppLayout';
import { ToastContainer } from './components/common/Toast';
import { OnboardingOverlay } from './components/Onboarding/OnboardingOverlay';
import i18n from './i18n';
import { useConfigStore } from './store/configStore';
import { useGenerateStore } from './store/generateStore';

const ONBOARDING_KEY = 'banana-onboarding-done';
const queryClient = new QueryClient();

function App() {
  const language = useConfigStore((s) => s.language);
  const apiKey = useConfigStore((s) => s.imageApiKey);
  const generateStatus = useGenerateStore((s) => s.status);
  const isSubmitting = useGenerateStore((s) => s.isSubmitting);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem(ONBOARDING_KEY) && !apiKey;
  });

  useEffect(() => {
    if (!language) return;
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language]);

  // Tauri: 同步生成状态，防止生成中误关窗口
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    const active = generateStatus === 'processing' || isSubmitting;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core' as any);
        await invoke('set_generation_active', { active });
      } catch (e) {
        console.warn('[quit-guard] 同步生成状态失败', e);
      }
    })();
  }, [generateStatus, isSubmitting]);

  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setShowOnboarding(false);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AppLayout />
      <ToastContainer />
      {showOnboarding && <OnboardingOverlay onDismiss={dismissOnboarding} />}
    </QueryClientProvider>
  );
}

export default App;
