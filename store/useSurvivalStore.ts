
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SurvivalState, CurrencyType } from '../types';
import { migrateLocalStorageKey } from '../utils/storageMigration';

migrateLocalStorageKey('rahnam-survival-storage-v2', 'rava-survival-storage-v2');

interface ExtendedSurvivalState extends SurvivalState {
  isMapFullscreen: boolean;
  activeCurrency: CurrencyType;
  setMapFullscreen: (val: boolean) => void;
  setActiveCurrency: (curr: CurrencyType) => void;
}

export const useSurvivalStore = create<ExtendedSurvivalState>()(
  persist(
    (set) => ({
      rates: { TRY: 1850, AED: 17500 },
      activeFlashcard: null,
      isMapFullscreen: false,
      activeCurrency: 'IRT',

      setRate: (currency, val) => set((state) => ({ 
        rates: { ...state.rates, [currency]: val } 
      })),

      setActiveFlashcard: (card) => set({ activeFlashcard: card }),
      setMapFullscreen: (val) => set({ isMapFullscreen: val }),
      setActiveCurrency: (activeCurrency) => set({ activeCurrency }),
    }),
    {
      name: 'rava-survival-storage-v2',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
