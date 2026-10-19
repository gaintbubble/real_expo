"use client";

import React, { createContext, useContext, useState } from 'react';

export type PendingFilterType = 'all' | 'result_done' | 'result_verified' | 'result_approval';
export type PendingDelayMode = 'all' | 'delay';

export interface PendingCounts {
  resultDonePending: number;
  resultDoneTotal: number;
  resultVerifiedPending: number;
  resultVerifiedTotal: number;
  resultApprovalPending: number;
  resultApprovalTotal: number;
}

interface SearchContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  pendingFilter: PendingFilterType;
  setPendingFilter: (filter: PendingFilterType) => void;
  pendingDelayMode: PendingDelayMode;
  setPendingDelayMode: (mode: PendingDelayMode) => void;
  pendingCounts: PendingCounts;
  setPendingCounts: (counts: PendingCounts) => void;
}

const DEFAULT_PENDING_COUNTS: PendingCounts = {
  resultDonePending: 0,
  resultDoneTotal: 0,
  resultVerifiedPending: 0,
  resultVerifiedTotal: 0,
  resultApprovalPending: 0,
  resultApprovalTotal: 0,
};

const SearchContext = createContext<SearchContextType>({
  searchQuery: '',
  setSearchQuery: () => {},
  clearSearch: () => {},
  pendingFilter: 'all',
  setPendingFilter: () => {},
  pendingDelayMode: 'delay',
  setPendingDelayMode: () => {},
  pendingCounts: DEFAULT_PENDING_COUNTS,
  setPendingCounts: () => {},
});

export const SearchProvider = ({ children }: { children: React.ReactNode }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingFilter, setPendingFilter] = useState<PendingFilterType>('all');
  const [pendingDelayMode, setPendingDelayMode] = useState<PendingDelayMode>('delay');
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>(DEFAULT_PENDING_COUNTS);

  const clearSearch = () => setSearchQuery('');

  return (
    <SearchContext.Provider 
      value={{ 
        searchQuery, 
        setSearchQuery, 
        clearSearch,
        pendingFilter,
        setPendingFilter,
        pendingDelayMode,
        setPendingDelayMode,
        pendingCounts,
        setPendingCounts
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

export const useSearch = () => useContext(SearchContext);
