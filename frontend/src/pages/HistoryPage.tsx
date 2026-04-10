import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHistoryStore } from '@/store/historyStore';
import { useTranslation } from 'react-i18next';
import { HistoryList } from '@/components/HistoryPanel/HistoryList';
import { AlbumView, type AlbumViewRef } from '@/components/HistoryPanel/AlbumView';
import { CreateFolderDialog } from '@/components/HistoryPanel/CreateFolderDialog';

export function HistoryPage() {
  const { t } = useTranslation();
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const viewMode = useHistoryStore((s) => s.viewMode);
  const folders = useHistoryStore((s) => s.folders);
  const loadFolders = useHistoryStore((s) => s.loadFolders);
  const searchKeyword = useHistoryStore((s) => s.searchKeyword);
  const setSearchKeyword = useHistoryStore((s) => s.setSearchKeyword);
  const selectedFolderId = useHistoryStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useHistoryStore((s) => s.setSelectedFolderId);

  const [isCreateFolderDialogOpen, setIsCreateFolderDialogOpen] = useState(false);
  const albumViewRef = useRef<AlbumViewRef>(null);

  useEffect(() => {
    // 每次进入历史页都重新加载，确保状态同步
    void loadHistory(true);
    void loadFolders();
  }, [loadHistory, loadFolders]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 gap-5">
      {/* Top row: search */}
      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2.5 bg-surface-secondary border border-border rounded-lg px-3.5 py-2.5">
          <Search className="w-4 h-4 text-fg-muted shrink-0" />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => {
              setSearchKeyword(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void loadHistory();
              }
            }}
            placeholder={t('history.search')}
            className="flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-muted outline-none"
          />
          {searchKeyword && (
            <button
              onClick={() => { setSearchKeyword(''); void loadHistory(); }}
              className="text-fg-muted hover:text-fg-primary text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Folder category row */}
      <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden pb-1 scrollbar-none">
        <button
          onClick={() => setSelectedFolderId(null)}
          className={cn(
            'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors',
            selectedFolderId === null ? 'bg-primary/15 text-primary' : 'bg-surface-secondary text-fg-secondary hover:text-fg-primary'
          )}
        >
          {t('common.all', '全部')}
        </button>
        {folders.map((folder) => (
          <button
            key={folder.id}
            onClick={() => setSelectedFolderId(String(folder.id))}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors',
              selectedFolderId === String(folder.id) ? 'bg-primary/15 text-primary' : 'bg-surface-secondary text-fg-secondary hover:text-fg-primary'
            )}
          >
            {folder.name}
          </button>
        ))}
        <button
          onClick={() => setIsCreateFolderDialogOpen(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-secondary text-fg-muted text-xs hover:text-fg-secondary transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('batch.new')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {viewMode === 'timeline' ? (
          <HistoryList padding={0} />
        ) : (
          <AlbumView ref={albumViewRef} />
        )}
      </div>

      <CreateFolderDialog
        isOpen={isCreateFolderDialogOpen}
        onClose={() => setIsCreateFolderDialogOpen(false)}
        onSuccess={() => { void loadFolders(); }}
      />
    </div>
  );
}
