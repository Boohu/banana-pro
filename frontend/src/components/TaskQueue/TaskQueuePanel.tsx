import React from 'react';
import { ChevronDown, Trash2, Download, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGenerateStore } from '@/store/generateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import type { GeneratedImage } from '@/types';

interface TaskQueuePanelProps {
  onClose: () => void;
}

export function TaskQueuePanel({ onClose }: TaskQueuePanelProps) {
  const { t } = useTranslation();
  const { images, status } = useGenerateStore(
    useShallow((s) => ({ images: s.images, status: s.status }))
  );

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-surface-secondary border-t border-border shadow-[0_-8px_32px_rgba(0,0,0,0.4)] z-20 flex flex-col" style={{ height: '360px' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold text-fg-primary">{t('taskQueue.title')}</h3>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
          {images.length} {t('taskQueue.tasks')}
        </span>
        <div className="flex-1" />
        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg-secondary transition-colors">
          <Trash2 className="w-3 h-3" />
          {t('taskQueue.clearCompleted')}
        </button>
        <button onClick={onClose} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] text-fg-muted hover:text-fg-secondary transition-colors">
          <ChevronDown className="w-3.5 h-3.5" />
          {t('taskQueue.collapse')}
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5">
        {images.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-fg-muted">{t('taskQueue.noTasks')}</div>
        ) : (
          images.map((img, i) => (
            <TaskQueueItem key={img.id || i} image={img} />
          ))
        )}
      </div>
    </div>
  );
}

function TaskQueueItem({ image }: { image: GeneratedImage }) {
  const isCompleted = !!image.url;
  const isFailed = image.status === 'failed';
  const isPending = !isCompleted && !isFailed;

  return (
    <div className={cn(
      'flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-surface-tertiary',
      isPending && 'ring-1 ring-primary'
    )}>
      <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', isCompleted ? 'bg-success' : isFailed ? 'bg-error' : 'bg-primary')} />
      <span className={cn('flex-1 text-[13px] font-medium truncate', isCompleted ? 'text-fg-primary' : isFailed ? 'text-fg-secondary' : 'text-fg-primary')}>
        {image.prompt ? image.prompt.slice(0, 40) : `Task ${image.taskId?.slice(-6) || ''}`}
      </span>
      {image.createdAt && (
        <span className="text-[11px] text-fg-muted font-mono shrink-0">
          {new Date(image.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      <div className="w-14 text-center shrink-0">
        {isCompleted ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/15 text-success">完成</span>
        ) : isFailed ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-error/15 text-error">失败</span>
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin mx-auto" />
        )}
      </div>
      {isCompleted && (
        <button className="text-fg-muted hover:text-fg-secondary transition-colors shrink-0">
          <Download className="w-3.5 h-3.5" />
        </button>
      )}
      {isPending && (
        <button className="text-fg-muted hover:text-error transition-colors shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
