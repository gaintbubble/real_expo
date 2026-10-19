"use client";

import React, { useState, useEffect } from 'react';
import Sidebar from "./Sidebar";
import Header from "./Header";
import { usePathname, useRouter } from "next/navigation";
import { SearchProvider } from "../context/SearchContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [userModules, setUserModules] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    if (pathname === '/login') return;

    const stored = localStorage.getItem('nexus_user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        const mods: string[] = user.modules || [];
        setUserModules(mods);

        // Route protection: prevent direct URL access to unauthorized pages
        const routeModuleMap: Record<string, string> = {
          '/departments': 'Departments',
          '/test-config': 'Test Config',
          '/users': 'Users',
        };

        const requiredModule = routeModuleMap[pathname];
        if (requiredModule && !mods.includes(requiredModule)) {
          router.replace('/');
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      router.replace('/login');
    }
  }, [pathname, router]);
  
  if (pathname === '/login') {
    return <>{children}</>;
  }

  // Only evaluate client-specific module access after mounting to avoid SSR hydration mismatches
  const hasOtherModules = mounted && userModules.some(item => item !== 'Dashboard');

  return (
    <SearchProvider>
      <div className="app-layout">
        {hasOtherModules && <Sidebar userModules={userModules} />}
        <div className="main-wrapper">
          <Header showLogo={!hasOtherModules} />
          <main className="main-content">
            {children}
          </main>
        </div>
      </div>
    </SearchProvider>
  );
}
