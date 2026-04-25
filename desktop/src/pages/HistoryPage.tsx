import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Search, Plus, CheckSquare, MinusSquare, Square, Download, Trash2, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHistoryStore } from '@/store/historyStore';
import { useTranslation } from 'react-i18next';
import { HistoryList } from '@/components/HistoryPanel/HistoryList';
import { AlbumView, type AlbumViewRef } from '@/components/HistoryPanel/AlbumView';
import { CreateFolderDialog } from '@/components/HistoryPanel/CreateFolderDialog';
import { exportImages, deleteBatchHistory } from '@/services/historyApi';
import { toast } from '@/store/toastStore';

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

  // 多选状态
  const items = useHistoryStore((s) => s.items);
  const multiSelectMode = useHistoryStore((s) => s.multiSelectMode);
  const setMultiSelectMode = useHistoryStore((s) => s.setMultiSelectMode);
  const selectedImageIds = useHistoryStore((s) => s.selectedImageIds);
  const selectAllImages = useHistoryStore((s) => s.selectAllImages);
  const clearImageSelection = useHistoryStore((s) => s.clearImageSelection);

  const [isCreateFolderDialogOpen, setIsCreateFolderDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const albumViewRef = useRef<AlbumViewRef>(null);

  useEffect(() => {
    // 每次进入历史页都重新加载，确保状态同步
    void loadHistory(true);
    void loadFolders();
  }, [loadHistory, loadFolders]);

  // 退出页面或关闭多选时清掉选择
  useEffect(() => {
    return () => {
      setMultiSelectMode(false);
    };
  }, [setMultiSelectMode]);

  // 当前页面所有可见图片的有序 id 列表（用于「全选」「Shift 区间选」「拖选」）
  const orderedImageIds = useMemo(() => {
    const ids: string[] = [];
    for (const item of items) {
      if (item.images) {
        for (const img of item.images) {
          if (img.url) ids.push(img.id); // 仅成功的可选
        }
      }
    }
    return ids;
  }, [items]);

  const selectedCount = selectedImageIds.size;
  const allSelected = orderedImageIds.length > 0 && selectedCount === orderedImageIds.length;
  const hasSelection = selectedCount > 0;

  const handleToggleAll = () => {
    if (hasSelection) {
      clearImageSelection();
    } else {
      selectAllImages(orderedImageIds);
    }
  };

  const handleExport = async () => {
    if (selectedCount === 0) return;
    setIsExporting(true);
    try {
      const { blob, partial } = await exportImages(Array.from(selectedImageIds));

      if (blob.type === 'application/json' || blob.type === 'text/plain') {
        const errorText = await blob.text();
        try {
          const errorRes = JSON.parse(errorText);
          toast.error(errorRes.message || '导出失败');
        } catch {
          toast.error(errorText || '导出失败');
        }
        return;
      }

      const defaultName = `history-${Date.now()}.zip`;
      const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

      if (isTauri) {
        try {
          // @ts-ignore Tauri 运行时解析
          const { save } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
          const lastDir = localStorage.getItem('banana-last-export-dir') || '';
          const defaultPath = lastDir ? `${lastDir}/${defaultName}` : defaultName;
          const destPath = await save({
            defaultPath,
            filters: [{ name: 'Zip', extensions: ['zip'] }],
            title: '导出图片',
          });
          if (!destPath) return;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          // @ts-ignore Tauri 运行时解析
          const { writeFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
          await writeFile(destPath as string, bytes);
          const dir = String(destPath).replace(/\/[^/]+$/, '').replace(/\\[^\\]+$/, '');
          if (dir) localStorage.setItem('banana-last-export-dir', dir);
          toast.success(`已导出 ${selectedCount} 张到 ${destPath}` + (partial ? '（部分图片缺失）' : ''));
        } catch (err) {
          console.error('[HistoryPage] Tauri 导出失败:', err);
          toast.error('导出失败：' + (err instanceof Error ? err.message : String(err)));
        }
        return;
      }

      // Web 端：浏览器下载
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      if (partial) {
        toast.info(`已导出（部分图片缺失）`);
      } else {
        toast.success(`已导出 ${selectedCount} 张`);
      }
    } catch (error) {
      console.error('[HistoryPage] 导出失败:', error);
      toast.error('导出失败：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsExporting(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedCount === 0) return;
    try {
      await deleteBatchHistory(Array.from(selectedImageIds));
      toast.success(`已删除 ${selectedCount} 张`);
      clearImageSelection();
      setShowDeleteConfirm(false);
      void loadHistory(true);
    } catch (err) {
      console.error('[HistoryPage] 批量删除失败:', err);
      toast.error('删除失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 gap-5">
      {/* Top row: search + multi-select 开关 */}
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
        {/* 多选开关 */}
        <button
          onClick={() => setMultiSelectMode(!multiSelectMode)}
          className={cn(
            'flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors shrink-0',
            multiSelectMode
              ? 'bg-primary text-primary-foreground'
              : 'bg-surface-secondary text-fg-secondary hover:text-fg-primary border border-border'
          )}
          title={multiSelectMode ? '退出多选' : '进入多选'}
        >
          {multiSelectMode ? <X className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
          {multiSelectMode ? '退出多选' : '多选'}
        </button>
      </div>

      {/* 多选模式工具栏 */}
      {multiSelectMode && (
        <div className="flex items-center justify-between bg-surface-secondary border border-border rounded-lg px-4 py-2.5 gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleAll}
              className="flex items-center gap-1.5 text-xs text-fg-secondary hover:text-fg-primary transition-colors"
            >
              {allSelected ? <CheckSquare className="w-4 h-4" />
                : hasSelection ? <MinusSquare className="w-4 h-4" />
                : <Square className="w-4 h-4" />}
              {hasSelection ? '取消选择' : '全选'}
            </button>
            <span className="text-xs text-fg-muted">已选 {selectedCount} 项</span>
            <span className="text-[10px] text-fg-muted/60">提示：拖动框选 · Shift+点击 区间选</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={!hasSelection || isExporting}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                !hasSelection || isExporting
                  ? 'bg-surface-tertiary text-fg-muted cursor-not-allowed'
                  : 'bg-primary/15 text-primary hover:bg-primary/25'
              )}
            >
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {isExporting ? '导出中…' : '批量下载'}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!hasSelection}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                !hasSelection
                  ? 'bg-surface-tertiary text-fg-muted cursor-not-allowed'
                  : 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
              )}
            >
              <Trash2 className="w-3.5 h-3.5" />
              批量删除
            </button>
          </div>
        </div>
      )}

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
          <HistoryList padding={0} orderedIds={orderedImageIds} />
        ) : (
          <AlbumView ref={albumViewRef} orderedIds={orderedImageIds} />
        )}
      </div>

      <CreateFolderDialog
        isOpen={isCreateFolderDialogOpen}
        onClose={() => setIsCreateFolderDialogOpen(false)}
        onSuccess={() => { void loadFolders(); }}
      />

      {/* 批量删除确认 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-surface-secondary border border-border rounded-xl shadow-2xl w-[380px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-fg-primary mb-2">批量删除</h3>
            <p className="text-sm text-fg-secondary mb-5">确定要删除选中的 {selectedCount} 张图片吗？此操作不可恢复。</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg bg-surface-tertiary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-4 py-2 rounded-lg bg-rose-500 text-white text-sm font-medium hover:bg-rose-600 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
