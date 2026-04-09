import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Folder, getFolders, createFolder } from '../../services/folderApi';
import { toast } from '../../store/toastStore';
import { Folder as FolderIcon } from 'lucide-react';

interface CreateFolderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (folder: Folder) => void;
}

export function CreateFolderDialog({ 
  isOpen, 
  onClose, 
  onSuccess 
}: CreateFolderDialogProps) {
  const { t } = useTranslation();
  
  const [folderName, setFolderName] = useState('');
  const [existingFolders, setExistingFolders] = useState<Folder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const loadExistingFolders = useCallback(async () => {
    setIsLoading(true);
    try {
      const folders = await getFolders();
      setExistingFolders(folders);
    } catch (error) {
      console.error('Failed to load folders:', error);
      toast.error(t('history.folder.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      void loadExistingFolders();
      setFolderName('');
    }
  }, [isOpen, loadExistingFolders]);

  const isNameExists = useCallback((name: string): boolean => {
    const trimmedName = name.trim();
    if (!trimmedName) return false;
    const lowerCaseName = trimmedName.toLowerCase();
    return existingFolders.some(
      folder => folder.name.toLowerCase() === lowerCaseName
    );
  }, [existingFolders]);

  const validationError = React.useMemo(() => {
    const trimmedName = folderName.trim();
    if (!trimmedName) {
      return t('history.folder.nameRequired');
    }
    if (isNameExists(folderName)) {
      return t('history.folder.nameExists');
    }
    return null;
  }, [folderName, isNameExists, t]);

  const canCreate = !validationError && !isLoading && !isCreating;

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;

    setIsCreating(true);
    try {
      const newFolder = await createFolder({ name: folderName.trim() });
      toast.success(t('history.folder.createSuccess'));
      onSuccess?.(newFolder);
      onClose();
    } catch (error) {
      console.error('Failed to create folder:', error);
      toast.error(t('history.folder.createFailed'));
    } finally {
      setIsCreating(false);
    }
  }, [canCreate, folderName, onClose, onSuccess, t]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFolderName(e.target.value);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canCreate) {
      void handleCreate();
    }
  }, [canCreate, handleCreate]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('history.folder.create')}
      density="compact"
      className="max-w-md"
    >
      <div className="space-y-6">
        <div className="flex items-center gap-4 p-4 bg-primary/10 rounded-2xl">
          <div className="w-12 h-12 bg-primary/15 rounded-xl flex items-center justify-center flex-shrink-0">
            <FolderIcon className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-fg-secondary">
              {t('history.folder.createPlaceholder')}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold text-fg-secondary">
            {t('history.folder.title')}
          </label>
          <input
            type="text"
            value={folderName}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={t('history.folder.createPlaceholder')}
            disabled={isCreating}
            className={`
              w-full px-4 py-3 rounded-xl border-2 text-sm font-medium
              bg-surface-tertiary text-fg-primary placeholder:text-fg-muted
              transition-all duration-200 outline-none
              ${validationError
                ? 'border-red-300 focus:border-red-500'
                : 'border-border focus:border-blue-500 hover:border-border'
              }
              disabled:bg-surface-tertiary disabled:cursor-not-allowed
            `}
            autoFocus
          />
          {validationError && (
            <p className="text-xs font-medium text-error">
              {validationError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isCreating}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!canCreate}
          >
            {isCreating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                {t('common.loading')}
              </>
            ) : (
              t('common.confirm')
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default CreateFolderDialog;
