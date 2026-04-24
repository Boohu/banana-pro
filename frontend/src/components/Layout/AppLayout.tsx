import { Sidebar } from './Sidebar';
import { useNavigationStore } from '@/store/navigationStore';
import { useTaskRecovery } from '@/hooks/useTaskRecovery';
import { GeneratePage } from '@/pages/GeneratePage';
import { BatchPage } from '@/pages/BatchPage';
import { PromptReversePage } from '@/pages/PromptReversePage';
import { HistoryPage } from '@/pages/HistoryPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SubscriptionPage } from '@/pages/SubscriptionPage';

const pageComponents: Record<string, React.ComponentType> = {
  generate: GeneratePage,
  batch: BatchPage,
  'reverse-prompt': PromptReversePage,
  history: HistoryPage,
  templates: TemplatesPage,
  settings: SettingsPage,
  subscription: SubscriptionPage,
};

// macOS Overlay 模式下系统不给默认拖动区，需要自己提供
const isTauriMac = () => {
  if (typeof window === 'undefined') return false;
  if (!(window as any).__TAURI_INTERNALS__) return false;
  return /Mac/i.test(navigator.userAgent);
};

export function AppLayout() {
  const currentPage = useNavigationStore((s) => s.currentPage);
  const PageComponent = pageComponents[currentPage] || GeneratePage;
  const showDragBar = isTauriMac();

  // 应用启动时恢复卡住的生成任务
  useTaskRecovery();

  return (
    <div className="flex flex-col h-screen bg-surface-primary overflow-hidden">
      {showDragBar && (
        <div
          data-tauri-drag-region
          className="h-8 shrink-0 bg-surface-secondary border-b border-border/50"
        />
      )}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex overflow-hidden">
          <PageComponent />
        </main>
      </div>
    </div>
  );
}
