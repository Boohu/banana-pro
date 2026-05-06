import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Page = 'generate' | 'batch' | 'reverse-prompt' | 'rembg-tool' | 'history' | 'templates' | 'settings' | 'subscription';

interface NavigationState {
  currentPage: Page;
  setPage: (page: Page) => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      currentPage: 'generate',
      setPage: (page) => set({ currentPage: page }),
    }),
    {
      name: 'banana-navigation',
    }
  )
);
