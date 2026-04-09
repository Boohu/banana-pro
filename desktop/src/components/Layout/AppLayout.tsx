import { Sidebar } from './Sidebar';
import { useNavigationStore } from '@/store/navigationStore';
import { useTaskRecovery } from '@/hooks/useTaskRecovery';
import { GeneratePage } from '@/pages/GeneratePage';
import { BatchPage } from '@/pages/BatchPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { SettingsPage } from '@/pages/SettingsPage';

const pageComponents = {
  generate: GeneratePage,
  batch: BatchPage,
  history: HistoryPage,
  templates: TemplatesPage,
  settings: SettingsPage,
} as const;

export function AppLayout() {
  const currentPage = useNavigationStore((s) => s.currentPage);
  const PageComponent = pageComponents[currentPage] || GeneratePage;

  // 应用启动时恢复卡住的生成任务
  useTaskRecovery();

  return (
    <div className="flex h-screen bg-surface-primary overflow-hidden relative">
      <div data-tauri-drag-region className="absolute top-0 left-0 w-60 h-6 z-50" />
      <Sidebar />
      <main className="flex-1 flex overflow-hidden">
        <PageComponent />
      </main>
    </div>
  );
}
