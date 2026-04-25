import React, { useState, useRef, useEffect } from 'react';
import { CheckSquare, Square, MinusSquare, Download, Trash2, Loader2 } from 'lucide-react';
import { useGenerateStore } from '../../store/generateStore';
import { Button } from '../common/Button';
import { exportImages } from '../../services/historyApi';
import { toast } from '../../store/toastStore';
import { useTranslation } from 'react-i18next';

export function BatchActions() {
  const { t } = useTranslation();
  const { images, selectedIds, selectAll, clearSelection, clearImages } = useGenerateStore();
  const [isExporting, setIsExporting] = useState(false);
  const objectUrlRef = useRef<string | null>(null);  // 记录 ObjectURL

  // 清空列表的确认状态
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const clearConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清理 ObjectURL 和定时器
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        window.URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      if (clearConfirmTimerRef.current) {
        clearTimeout(clearConfirmTimerRef.current);
      }
    };
  }, []);

  if (images.length === 0) return null;

  const allSelected = images.length > 0 && selectedIds.size === images.length;
  const hasSelection = selectedIds.size > 0;

  // 处理清空列表
  const handleClearImages = () => {
    if (showClearConfirm) {
      // 确认清空
      clearImages();
      toast.success(t('generate.batch.clearSuccess'));
      setShowClearConfirm(false);
    } else {
      // 显示确认状态
      setShowClearConfirm(true);
      if (clearConfirmTimerRef.current) {
        clearTimeout(clearConfirmTimerRef.current);
      }
      clearConfirmTimerRef.current = setTimeout(() => setShowClearConfirm(false), 3000);
    }
  };

  const handleExport = async () => {
      if (selectedIds.size === 0) return;
      setIsExporting(true);
      try {
          const { blob, partial } = await exportImages(Array.from(selectedIds));

          // 检查响应类型
          if (blob.type === 'application/json' || blob.type === 'text/plain') {
              // 后端返回了错误 JSON/文本 而不是文件
              // 使用 Promise 包装 FileReader 避免 return 导致 finally 不执行
              const errorText = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = () => reject(new Error(t('generate.batch.readError')));
                  reader.readAsText(blob);
              });

              try {
                  const errorRes = JSON.parse(errorText);
                  toast.error(errorRes.message || t('generate.batch.exportFailed'));
              } catch (parseError) {
                  // 不是 JSON，显示文本内容
                  toast.error(errorText || t('generate.batch.exportFailedServer'));
              }
              return;
          }

          const defaultName = `images-${Date.now()}.zip`;
          const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

          if (isTauri) {
              // 桌面端：Tauri WebView 不支持 <a download>，必须走 dialog.save + fs.writeFile
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
                  if (!destPath) return; // 用户取消

                  const bytes = new Uint8Array(await blob.arrayBuffer());
                  // @ts-ignore Tauri 运行时解析
                  const { writeFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
                  await writeFile(destPath as string, bytes);

                  // 记录上次导出目录
                  const dir = String(destPath).replace(/\/[^/]+$/, '').replace(/\\[^\\]+$/, '');
                  if (dir) localStorage.setItem('banana-last-export-dir', dir);

                  if (partial) {
                      toast.info(t('generate.batch.exportPartial') + ` 已保存到 ${destPath}`);
                  } else {
                      toast.success(`已导出 ${selectedIds.size} 张到 ${destPath}`);
                  }
              } catch (err) {
                  console.error('[BatchActions] Tauri 导出失败:', err);
                  toast.error('导出失败：' + (err instanceof Error ? err.message : String(err)));
              }
              return;
          }

          // Web 端：浏览器下载到默认下载目录
          if (objectUrlRef.current) {
              window.URL.revokeObjectURL(objectUrlRef.current);
          }
          const url = window.URL.createObjectURL(blob);
          objectUrlRef.current = url;

          const a = document.createElement('a');
          a.href = url;
          a.download = defaultName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          if (partial) {
              toast.info(t('generate.batch.exportPartial'));
          } else {
              toast.success(t('generate.batch.exported', { count: selectedIds.size }));
          }
      } catch (error) {
          console.error('Export failed:', error);

          // 更详细的错误处理
          let errorMessage = t('generate.batch.exportFailedRetry');
          if (error instanceof Error) {
              if (error.message.includes('Network Error')) {
                  errorMessage = t('generate.batch.networkError');
              } else if (error.message.includes('timeout')) {
                  errorMessage = t('generate.batch.timeout');
              } else if (error.message.includes('404')) {
                  errorMessage = t('generate.batch.serviceUnavailable');
              } else if (error.message.includes('500')) {
                  errorMessage = t('generate.batch.serverError');
              } else {
                  errorMessage = error.message || errorMessage;
              }
          }
          toast.error(errorMessage);
      } finally {
          setIsExporting(false);
      }
  };

  return (
    <div className="bg-surface-secondary border-t border-border p-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button
            variant="ghost"
            size="sm"
            onClick={hasSelection ? clearSelection : selectAll}
            className="text-fg-secondary"
        >
          {allSelected
            ? <CheckSquare className="w-4 h-4 mr-2" />
            : hasSelection
              ? <MinusSquare className="w-4 h-4 mr-2" />
              : <Square className="w-4 h-4 mr-2" />}
          {hasSelection ? t('generate.batch.clearSelection') : t('generate.batch.selectAll')}
        </Button>
        <span className="text-sm text-fg-muted ml-2">
            {t('generate.batch.selectedCount', { count: selectedIds.size })}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleExport}
            disabled={!hasSelection || isExporting}
            className="text-primary border-blue-200 hover:bg-primary/10"
        >
          {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          {isExporting ? t('generate.batch.exporting') : t('generate.batch.exportSelected')}
        </Button>
        <Button
            variant="ghost"
            size="sm"
            onClick={handleClearImages}
            className={showClearConfirm
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'text-error hover:bg-error/10 hover:text-error'
            }
        >
          <Trash2 className="w-4 h-4 mr-2" />
          {showClearConfirm ? t('generate.batch.clearConfirm') : t('generate.batch.clearList')}
        </Button>
      </div>
    </div>
  );
}
