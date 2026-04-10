import React, { useState, useEffect, useMemo } from 'react';
import { Search, Flame, Star, X, Wand2, Heart, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTemplates } from '@/services/templateApi';
import { useConfigStore } from '@/store/configStore';
import { useNavigationStore } from '@/store/navigationStore';
import { useTranslation } from 'react-i18next';
import { communityTemplates, communityTemplateChannels } from '@/data/communityTemplates';
import type { TemplateItem, TemplateListResponse } from '@/types';

function TemplateCard({ item, onClick }: { item: TemplateItem; onClick: () => void }) {
  const { t } = useTranslation();
  const previewUrl = item.preview || item.image || '';
  return (
    <button onClick={onClick} className="flex flex-col rounded-2xl bg-surface-secondary overflow-hidden hover:ring-1 hover:ring-primary/50 transition-all text-left group">
      <div className="aspect-square bg-surface-tertiary overflow-hidden">
        {previewUrl ? (
          <img src={previewUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-fg-muted text-xs">{t('templates.noPreview')}</div>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <h3 className="text-sm font-semibold text-fg-primary truncate">{item.title}</h3>
        <p className="text-[11px] text-fg-muted truncate">{item.channels?.join(' · ') || item.industries?.join(' · ') || ''}</p>
        {item.tags && item.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {item.tags.slice(0, 3).map((tag, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function TemplateDetailModal({ item, onClose }: { item: TemplateItem; onClose: () => void }) {
  const { t } = useTranslation();
  const setPrompt = useConfigStore((s) => s.setPrompt);
  const setPage = useNavigationStore((s) => s.setPage);
  const previewUrl = item.preview || item.image || '';

  const useTemplate = () => {
    if (item.prompt) setPrompt(item.prompt);
    setPage('generate');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-surface-secondary rounded-2xl w-[860px] max-h-[80vh] flex overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Left preview */}
        <div className="w-[380px] shrink-0 bg-surface-tertiary flex items-center justify-center p-8">
          {previewUrl ? (
            <img src={previewUrl} alt={item.title} className="max-w-full max-h-full rounded-xl object-contain" />
          ) : (
            <div className="text-fg-muted">{t('templates.noPreviewImage')}</div>
          )}
        </div>

        {/* Right info */}
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-fg-primary">{item.title}</h2>
              <p className="text-sm text-fg-secondary mt-1">{item.channels?.join(' · ')}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center text-fg-secondary hover:text-fg-primary">
              <X className="w-4 h-4" />
            </button>
          </div>

          {item.prompt && (
            <>
              <div className="h-px bg-border my-3" />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-fg-primary">{t('templates.promptTemplate')}</h4>
                <div className="bg-surface-tertiary rounded-lg p-3">
                  <p className="text-xs text-fg-secondary leading-relaxed">{item.prompt}</p>
                </div>
              </div>
            </>
          )}

          {item.tags && item.tags.length > 0 && (
            <>
              <div className="h-px bg-border my-3" />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-fg-primary">{t('templates.tags')}</h4>
                <div className="flex gap-1.5 flex-wrap">
                  {item.tags.map((tag, i) => (
                    <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary">{tag}</span>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex-1" />
          <div className="h-px bg-border my-4" />
          <div className="flex gap-3">
            <button onClick={useTemplate} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
              <Wand2 className="w-4 h-4" />
              {t('templates.useTemplate')}
            </button>
            <button
              onClick={() => { if (item.prompt) navigator.clipboard.writeText(item.prompt); }}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-surface-tertiary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors"
            >
              <Copy className="w-4 h-4" />
              {t('templates.copy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplatesPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<TemplateListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [selectedItem, setSelectedItem] = useState<TemplateItem | null>(null);

  useEffect(() => {
    // 直接使用社区模板，不加载旧 API 模板
    setData({
      meta: { channels: communityTemplateChannels, materials: [], industries: [], ratios: [] },
      items: communityTemplates as any[]
    } as any);
    setLoading(false);
  }, []);

  const categories = communityTemplateChannels;
  const allItems = communityTemplates as any as TemplateItem[];
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      const channels = item.channels || [];
      const matchesCategory = selectedCategory === '全部' || channels.includes(selectedCategory);
      const matchesSearch = !searchQuery || item.title.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery, allItems]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 搜索栏和分类标签置顶 */}
      <div className="p-6 pb-4 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-fg-primary">{t('templates.title')}</h2>
          <div className="w-72 flex items-center gap-2.5 bg-surface-secondary border border-border rounded-lg px-3.5 py-2">
            <Search className="w-4 h-4 text-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('templates.searchPlaceholder')}
              className="flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-muted outline-none"
            />
          </div>
        </div>

        {/* Category row */}
        <div className="flex flex-wrap items-center gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                'px-4 py-2 rounded-full text-xs font-medium transition-colors',
                selectedCategory === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-secondary text-fg-secondary hover:text-fg-primary'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 模板列表可滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-fg-muted text-sm">{t('templates.loading')}</div>
        ) : filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-fg-muted text-sm">{t('templates.empty')}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredItems.map((item) => (
              <TemplateCard key={item.id} item={item} onClick={() => setSelectedItem(item)} />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedItem && (
        <TemplateDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  );
}
