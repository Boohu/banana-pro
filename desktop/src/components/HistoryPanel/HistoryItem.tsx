import React from 'react';
import { useTranslation } from 'react-i18next';
import { HistoryItem as HistoryItemType } from '../../types';
import { Trash2, Download } from 'lucide-react';
import { getImageUrl, getImageDownloadUrl } from '../../services/api';
import { formatDateTime } from '../../utils/date';
import { toast } from '../../store/toastStore';

interface HistoryItemProps {
  item: HistoryItemType;
  onDelete: (id: string) => void;
}

// 使用 React.memo 防止不必要的重渲染
export const HistoryItem = React.memo(function HistoryItem({ item, onDelete }: HistoryItemProps) {
  const { t } = useTranslation();
  // 获取第一张图片用于展示
  const firstImage = item.images && item.images.length > 0 ? item.images[0] : null;
  const imageUrl = firstImage ? getImageUrl(firstImage.id) : '';

  // 下载第一张图片（桌面端用 Tauri 保存对话框，Web 端直接下载）
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firstImage) return;

    const isTauri = Boolean((window as any).__TAURI_INTERNALS__);
    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core' as any);
        const { save } = await import('@tauri-apps/plugin-dialog');
        const fileName = `generated-${firstImage.id.slice(0, 8)}.png`;
        const lastDir = localStorage.getItem('banana-last-save-dir') || '';
        const defaultPath = lastDir ? `${lastDir}/${fileName}` : fileName;
        const destPath = await save({
          defaultPath,
          filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        });
        if (!destPath) return;
        const dir = destPath.substring(0, destPath.lastIndexOf('/'));
        if (dir) localStorage.setItem('banana-last-save-dir', dir);
        await invoke('download_file_to_path', { url: getImageDownloadUrl(firstImage.id), destPath });
        toast.success(t('history.downloadSuccess', '已保存到 ') + destPath.split('/').pop());
      } catch (err) {
        console.error('Download failed:', err);
        toast.error(t('history.downloadFailed', '保存失败'));
      }
    } else {
      window.location.href = getImageDownloadUrl(firstImage.id);
    }
  };

  return (
    <div className="group flex gap-4 p-4 bg-surface-secondary rounded-lg border border-border hover:border-border hover:shadow-sm transition-all">
      <div className="w-24 h-24 flex-shrink-0 bg-surface-tertiary rounded-md overflow-hidden relative">
        {imageUrl ? (
            <img
                src={imageUrl}
                alt={item.prompt}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
            />
        ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-fg-muted bg-surface-tertiary">
                {t('history.noImage')}
            </div>
        )}
        <div className="absolute bottom-0 right-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-tl-md">
            {item.completedCount}/{item.totalCount}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
        <div>
            <p className="text-sm text-fg-primary font-medium line-clamp-2 mb-1">{item.prompt}</p>
            <div className="flex items-center gap-3 text-xs text-fg-muted">
                <span>{item.model}</span>
                <span>•</span>
                <span>{formatDateTime(item.createdAt)}</span>
            </div>
        </div>

        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
            {firstImage && (
              <button
                  onClick={handleDownload}
                  className="p-1.5 text-fg-muted hover:text-primary hover:bg-primary/10 rounded-md transition-colors"
                  title={t('history.actions.download', '下载')}
              >
                  <Download className="w-4 h-4" />
              </button>
            )}
            <button
                onClick={() => onDelete(item.id)}
                className="p-1.5 text-fg-muted hover:text-error hover:bg-error/10 rounded-md transition-colors"
                title={t('history.actions.deleteTask')}
            >
                <Trash2 className="w-4 h-4" />
             </button>
        </div>
      </div>
    </div>
  );
});
