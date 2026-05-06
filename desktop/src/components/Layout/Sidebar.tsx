import { Image, Layers, Sparkles, Scissors, FolderOpen, LayoutTemplate, Settings } from 'lucide-react';
import logoImg from '@/assets/logo.png';
import { cn } from '@/lib/utils';
import { useNavigationStore, type Page } from '@/store/navigationStore';
import { useTranslation } from 'react-i18next';

interface NavItem {
  id: Page;
  icon: React.ElementType;
  labelKey: string;
}

const mainNavItems: NavItem[] = [
  { id: 'generate', icon: Image, labelKey: 'sidebar.generate' },
  { id: 'batch', icon: Layers, labelKey: 'sidebar.batch' },
  { id: 'reverse-prompt', icon: Sparkles, labelKey: 'sidebar.reversePrompt' },
  { id: 'rembg-tool', icon: Scissors, labelKey: 'sidebar.rembgTool' },
  { id: 'history', icon: FolderOpen, labelKey: 'sidebar.history' },
  { id: 'templates', icon: LayoutTemplate, labelKey: 'sidebar.templates' },
];

export function Sidebar() {
  const { currentPage, setPage } = useNavigationStore();
  const { t } = useTranslation();

  return (
    <aside className="flex flex-col w-60 h-full bg-surface-secondary px-4 py-5 gap-4 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-1">
        <img src={logoImg} alt="logo" className="w-8 h-8 rounded-lg" />
        <span className="text-lg font-bold text-fg-primary">{t('sidebar.appName')}</span>
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Nav label */}
      <span className="text-xs font-medium text-fg-muted px-3">{t('sidebar.tools')}</span>

      {/* Main nav */}
      <nav className="flex flex-col gap-1">
        {mainNavItems.map((item) => {
          const isActive = currentPage === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-fg-secondary hover:bg-surface-tertiary'
              )}
            >
              <Icon className={cn('w-[18px] h-[18px]', isActive ? 'text-primary' : 'text-fg-muted')} />
              {t(item.labelKey)}
            </button>
          );
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Settings */}
      <button
        onClick={() => setPage('settings')}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors',
          currentPage === 'settings'
            ? 'bg-primary/15 text-primary font-medium'
            : 'text-fg-secondary hover:bg-surface-tertiary'
        )}
      >
        <Settings className={cn('w-[18px] h-[18px]', currentPage === 'settings' ? 'text-primary' : 'text-fg-muted')} />
        {t('sidebar.settings')}
      </button>
    </aside>
  );
}
