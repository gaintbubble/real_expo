"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  LogOut,
  ChevronLeft,
  ChevronRight,
  Building2,
  ClipboardList,
  UserCog,
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [userModules, setUserModules] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('nexus_user');
        if (stored) {
          const user = JSON.parse(stored);
          return user.modules || [];
        }
      } catch (e) {
        console.error(e);
      }
    }
    return [];
  });

  useEffect(() => {
    const stored = localStorage.getItem('nexus_user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        setUserModules(user.modules || []);
      } catch (e) {
        console.error(e);
      }
    } else {
      router.push('/login');
    }
  }, [router]);

  const allNavItems = [
    { name: 'Dashboard', href: '/', icon: <LayoutDashboard size={20} /> },
    { name: 'Departments', href: '/departments', icon: <Building2 size={20} /> },
    { name: 'Test Config', href: '/test-config', icon: <ClipboardList size={20} /> },
    { name: 'Users', href: '/users', icon: <UserCog size={20} /> },
  ];

  // If user only has access to Dashboard (or no additional modules), do not render/open sidebar
  const hasOtherModules = userModules.some(item => item !== 'Dashboard');
  if (!hasOtherModules) {
    return null;
  }

  const navItems = allNavItems.filter(item => userModules.includes(item.name));

  return (
    <>
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">AL</div>
            {!isCollapsed && <span className="logo-text">ASRAM Labs</span>}
          </div>
          <button 
            className="collapse-btn"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          <ul className="nav-list">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.name} className="nav-item">
                  <Link 
                    href={item.href} 
                    className={`nav-link ${isActive ? 'active' : ''}`}
                    title={isCollapsed ? item.name : ''}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    {!isCollapsed && <span className="nav-text">{item.name}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <Link 
            href="/login" 
            className="nav-link logout" 
            onClick={() => localStorage.removeItem('nexus_user')}
          >
            <span className="nav-icon"><LogOut size={20} /></span>
            {!isCollapsed && <span className="nav-text">Logout</span>}
          </Link>
        </div>
      </aside>
    </>
  );
}
