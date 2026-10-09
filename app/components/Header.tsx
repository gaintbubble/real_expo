"use client";

import React from 'react';
import { Bell, Search, User } from 'lucide-react';

export default function Header() {
  const [userName, setUserName] = React.useState('Guest');
  const [userRole, setUserRole] = React.useState('Loading...');

  React.useEffect(() => {
    const stored = localStorage.getItem('nexus_user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        setUserName(user.name);
        setUserRole(`@${user.username}`);
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  return (
    <header className="top-header">
      <div className="header-search">
        <Search size={18} className="search-icon" />
        <input 
          type="text" 
          placeholder="Search samples, patients, or barcodes..." 
          className="search-input"
        />
      </div>
      
      <div className="header-actions">
        <button className="icon-btn">
          <Bell size={20} />
          <span className="notification-dot"></span>
        </button>
        
        <div className="user-profile">
          <div className="avatar">
            <User size={18} />
          </div>
          <div className="user-info">
            <span className="user-name">{userName}</span>
            <span className="user-role">{userRole}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
