import React from 'react';
import { Sparkles, Key, Image, Layers, ArrowRight } from 'lucide-react';
import { useNavigationStore } from '@/store/navigationStore';
import { useTranslation } from 'react-i18next';

interface OnboardingOverlayProps {
  onDismiss: () => void;
}

const steps = [
  { icon: Key, title: '1. 配置 API', desc: '输入 Gemini 或 OpenAI 的 API Key 开始使用' },
  { icon: Image, title: '2. 输入提示词', desc: '描述你想要的图片，或上传参考图进行风格转换' },
  { icon: Layers, title: '3. 批量处理', desc: '选择本地文件夹，一键批量处理上百张图片' },
];

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
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary-foreground" />
          </div>
          <span className="text-4xl font-bold text-fg-primary">筋斗云AI</span>
        </div>

        <p className="text-base text-fg-secondary">{t('AI 驱动的图片生成与批量处理工具', 'AI 驱动的图片生成与批量处理工具')}</p>

        {/* Steps */}
        <div className="flex gap-6">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={i} className="w-[260px] bg-surface-secondary border border-border rounded-2xl p-6 flex flex-col items-center gap-3.5 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center">
                  <Icon className="w-[22px] h-[22px] text-primary" />
                </div>
                <h3 className="text-[15px] font-semibold text-fg-primary">{step.title}</h3>
                <p className="text-[13px] text-fg-secondary leading-relaxed">{step.desc}</p>
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
          {t('开始配置', '开始配置')}
        </button>
        <button onClick={onDismiss} className="text-sm text-fg-muted hover:text-fg-secondary transition-colors">
          {t('跳过，稍后在设置中配置', '跳过，稍后在设置中配置')}
        </button>
      </div>
    </div>
  );
}
