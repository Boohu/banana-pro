import React from 'react';
import { Key, Image, Layers, ArrowRight } from 'lucide-react';
import logoImg from '@/assets/logo.png';
import { useNavigationStore } from '@/store/navigationStore';
import { useTranslation } from 'react-i18next';

interface OnboardingOverlayProps {
  onDismiss: () => void;
}

const stepIcons = [Key, Image, Layers];

export function OnboardingOverlay({ onDismiss }: OnboardingOverlayProps) {
  const { t } = useTranslation();
  const setPage = useNavigationStore((s) => s.setPage);

  const goToSettings = () => {
    setPage('settings');
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-primary">
      <div className="flex flex-col items-center gap-8 max-w-3xl px-8">
        {/* Logo */}
        <div className="flex items-center gap-3.5">
          <img src={logoImg} alt="logo" className="w-14 h-14 rounded-2xl" />
          <span className="text-4xl font-bold text-fg-primary">{t('onboarding.appName')}</span>
        </div>

        <p className="text-base text-fg-secondary">{t('onboarding.appDesc')}</p>

        {/* Steps */}
        <div className="flex gap-6">
          {stepIcons.map((Icon, i) => {
            const stepNum = i + 1;
            return (
              <div key={i} className="w-[260px] bg-surface-secondary border border-border rounded-2xl p-6 flex flex-col items-center gap-3.5 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center">
                  <Icon className="w-[22px] h-[22px] text-primary" />
                </div>
                <h3 className="text-[15px] font-semibold text-fg-primary">{t(`onboarding.step${stepNum}Title`)}</h3>
                <p className="text-[13px] text-fg-secondary leading-relaxed">{t(`onboarding.step${stepNum}Desc`)}</p>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <button
          onClick={goToSettings}
          className="flex items-center gap-2.5 px-10 py-3.5 rounded-xl bg-primary text-primary-foreground text-base font-semibold hover:bg-primary/90 transition-colors"
        >
          <ArrowRight className="w-[18px] h-[18px]" />
          {t('onboarding.startConfig')}
        </button>
        <button onClick={onDismiss} className="text-sm text-fg-muted hover:text-fg-secondary transition-colors">
          {t('onboarding.skipConfig')}
        </button>
      </div>
    </div>
  );
}
