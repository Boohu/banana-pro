import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/Layout/AppLayout';
import { ToastContainer } from './components/common/Toast';
import { OnboardingOverlay } from './components/Onboarding/OnboardingOverlay';
import i18n from './i18n';
import { useConfigStore } from './store/configStore';

const ONBOARDING_KEY = 'banana-onboarding-done';
const queryClient = new QueryClient();

function App() {
  const language = useConfigStore((s) => s.language);
  const apiKey = useConfigStore((s) => s.imageApiKey);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem(ONBOARDING_KEY) && !apiKey;
  });

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

  return (
    <QueryClientProvider client={queryClient}>
      <AppLayout />
      <ToastContainer />
      {showOnboarding && <OnboardingOverlay onDismiss={dismissOnboarding} />}
    </QueryClientProvider>
  );
}

export default App;
