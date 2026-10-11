"use client";

import React from 'react';
import Sidebar from "./Sidebar";
import Header from "./Header";
import { usePathname } from "next/navigation";
import { SearchProvider } from "../context/SearchContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <SearchProvider>
      <div className="app-layout">
        <Sidebar />
        <div className="main-wrapper">
          <Header />
          <main className="main-content">
            {children}
          </main>
        </div>
      </div>
    </SearchProvider>
  );
}
