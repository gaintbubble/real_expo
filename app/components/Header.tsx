"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  User, 
  Key, 
  Eye, 
  EyeOff, 
  X, 
  Lock, 
  CheckCircle2, 
  AlertCircle, 
  ChevronDown, 
  LogOut 
} from 'lucide-react';
import { changePassword } from '../actions/auth';
import { useRouter, usePathname } from 'next/navigation';
import { useSearch } from '../context/SearchContext';

interface HeaderProps {
  showLogo?: boolean;
}

export default function Header({ showLogo }: HeaderProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { pendingFilter, setPendingFilter, pendingCounts } = useSearch();
  const [userName, setUserName] = useState('Guest');
  const [userRole, setUserRole] = useState('Loading...');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [internalShowLogo, setInternalShowLogo] = useState(false);

  const statusBars = [
    {
      id: 'result_done' as const,
      label: 'Result Done',
      pending: pendingCounts.resultDonePending,
      total: pendingCounts.resultDoneTotal,
      color: '#f59e0b',
      bgColor: 'rgba(245, 158, 11, 0.08)',
      borderColor: 'rgba(245, 158, 11, 0.25)',
      activeBorder: '#f59e0b',
      activeBg: 'rgba(245, 158, 11, 0.18)',
      activeGlow: '0 0 10px rgba(245, 158, 11, 0.35)',
    },
    {
      id: 'result_verified' as const,
      label: 'Result Verified',
      pending: pendingCounts.resultVerifiedPending,
      total: pendingCounts.resultVerifiedTotal,
      color: '#a855f7',
      bgColor: 'rgba(168, 85, 247, 0.08)',
      borderColor: 'rgba(168, 85, 247, 0.25)',
      activeBorder: '#a855f7',
      activeBg: 'rgba(168, 85, 247, 0.18)',
      activeGlow: '0 0 10px rgba(168, 85, 247, 0.35)',
    },
    {
      id: 'result_approval' as const,
      label: 'Result Approval',
      pending: pendingCounts.resultApprovalPending,
      total: pendingCounts.resultApprovalTotal,
      color: '#06b6d4',
      bgColor: 'rgba(6, 182, 212, 0.08)',
      borderColor: 'rgba(6, 182, 212, 0.25)',
      activeBorder: '#06b6d4',
      activeBg: 'rgba(6, 182, 212, 0.18)',
      activeGlow: '0 0 10px rgba(6, 182, 212, 0.35)',
    },
  ];

  // Dropdown & Modal states
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  // Password form states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Password visibility toggles
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | '' }>({ text: '', type: '' });

  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem('nexus_user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        setCurrentUser(user);
        setUserName(user.name);
        setUserRole(`@${user.username}`);
        const mods: string[] = user.modules || [];
        setInternalShowLogo(!mods.some((m: string) => m !== 'Dashboard'));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const shouldShowLogo = showLogo !== undefined ? showLogo : internalShowLogo;

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenPasswordModal = () => {
    setIsProfileMenuOpen(false);
    setMessage({ text: '', type: '' });
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setIsPasswordModalOpen(true);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ text: 'All fields are required.', type: 'error' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ text: 'New passwords do not match.', type: 'error' });
      return;
    }

    if (newPassword.length < 5) {
      setMessage({ text: 'New password must be at least 5 characters.', type: 'error' });
      return;
    }

    if (!currentUser?.id) {
      setMessage({ text: 'User session not found. Please log in again.', type: 'error' });
      return;
    }

    setLoading(true);
    const res = await changePassword(currentUser.id, currentPassword, newPassword);
    setLoading(false);

    if (res.success) {
      setMessage({ text: 'Password updated successfully!', type: 'success' });
      setTimeout(() => {
        setIsPasswordModalOpen(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setMessage({ text: '', type: '' });
      }, 1500);
    } else {
      setMessage({ text: res.message || 'Failed to update password.', type: 'error' });
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nexus_user');
    router.push('/login');
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '11px 40px 11px 38px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    outline: 'none',
    fontSize: '0.9rem',
    transition: 'border-color 0.2s',
  };

  return (
    <>
      <header className="top-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flex: 1, minWidth: 0 }}>
          {shouldShowLogo && (
            <div 
              className="sidebar-logo" 
              style={{ cursor: 'pointer', flexShrink: 0, userSelect: 'none' }}
              onClick={() => router.push('/')}
              title="ASRAM Labs Dashboard"
            >
              <div className="logo-icon">AL</div>
              <span className="logo-text">ASRAM Labs</span>
            </div>
          )}

          {/* Pending Status Bars */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', padding: '2px 0' }}>
            {statusBars.map(bar => {
              const isActive = pendingFilter === bar.id;
              const completionPct = bar.total > 0 ? Math.max(0, Math.min(100, Math.round(((bar.total - bar.pending) / bar.total) * 100))) : 100;
              
              return (
                <div
                  key={bar.id}
                  onClick={() => {
                    if (pathname !== '/') router.push('/');
                    setPendingFilter(isActive ? 'all' : bar.id);
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: '2px',
                    padding: '3px 8px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    background: isActive ? bar.activeBg : bar.bgColor,
                    border: `1px solid ${isActive ? bar.activeBorder : bar.borderColor}`,
                    boxShadow: isActive ? bar.activeGlow : 'none',
                    transition: 'all 0.2s ease',
                    userSelect: 'none',
                    minWidth: '125px',
                  }}
                  title={`Click to ${isActive ? 'clear filter' : 'filter'}: Showing ${bar.pending} pending of ${bar.total} ${bar.label}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '5px', fontSize: '0.72rem', lineHeight: 1.1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ 
                        width: '6px', 
                        height: '6px', 
                        borderRadius: '50%', 
                        background: bar.color, 
                        display: 'inline-block',
                        boxShadow: isActive ? `0 0 6px ${bar.color}` : 'none'
                      }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.1px', whiteSpace: 'nowrap' }}>
                        {bar.label}
                      </span>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '0.73rem', color: bar.pending > 0 ? bar.color : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      ({bar.pending}/{bar.total})
                    </span>
                  </div>
                  
                  {/* Mini progress bar */}
                  <div style={{ width: '100%', height: '3px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div 
                      style={{ 
                        width: `${completionPct}%`, 
                        height: '100%', 
                        background: bar.color,
                        borderRadius: '2px',
                        transition: 'width 0.4s ease'
                      }} 
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div className="header-actions">
          {/* User Profile with Dropdown */}
          <div ref={profileRef} style={{ position: 'relative' }}>
            <div 
              className="user-profile"
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
              title="Click to view menu"
            >
              <div className="avatar">
                <User size={18} />
              </div>
              <div className="user-info">
                <span className="user-name">{userName}</span>
                <span className="user-role">{userRole}</span>
              </div>
              <ChevronDown 
                size={16} 
                style={{ 
                  color: 'var(--text-secondary)',
                  transform: isProfileMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease'
                }} 
              />
            </div>

            {/* Profile Dropdown Menu */}
            {isProfileMenuOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: '210px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                padding: '6px',
                zIndex: 100,
                animation: 'fadeIn 0.15s ease-out',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', marginBottom: '4px' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{userName}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{userRole}</p>
                </div>

                <button
                  type="button"
                  onClick={handleOpenPasswordModal}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <Key size={15} style={{ color: 'var(--accent-primary)' }} />
                  <span>Change Password</span>
                </button>

                <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />

                <button
                  type="button"
                  onClick={handleLogout}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--danger)',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <LogOut size={15} />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Change Password Modal */}
      {isPasswordModalOpen && (
        <div 
          className="modal-overlay" 
          onClick={() => !loading && setIsPasswordModalOpen(false)}
          style={{ zIndex: 1000 }}
        >
          <div 
            className="modal-content" 
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '420px', padding: '1.75rem', borderRadius: '16px' }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ 
                  width: '36px', 
                  height: '36px', 
                  borderRadius: '10px', 
                  background: 'rgba(59, 130, 246, 0.15)', 
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Key size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>Change Password</h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Updating credentials for {userRole}
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => !loading && setIsPasswordModalOpen(false)}
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'var(--text-secondary)', 
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Status Message */}
            {message.text && (
              <div style={{ 
                padding: '10px 14px', 
                borderRadius: '8px', 
                marginBottom: '1.25rem', 
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: message.type === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                color: message.type === 'error' ? 'var(--danger)' : '#10b981',
                border: `1px solid ${message.type === 'error' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
                fontSize: '0.85rem'
              }}>
                {message.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span>{message.text}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Current Password
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock size={15} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                  <input 
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    style={inputStyle}
                    autoComplete="current-password"
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowCurrent(!showCurrent)}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  New Password
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock size={15} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                  <input 
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 5 characters"
                    style={inputStyle}
                    autoComplete="new-password"
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowNew(!showNew)}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Confirm New Password
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock size={15} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                  <input 
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    style={inputStyle}
                    autoComplete="new-password"
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowConfirm(!showConfirm)}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  disabled={loading}
                  onClick={() => setIsPasswordModalOpen(false)}
                  className="btn-secondary"
                  style={{ fontSize: '0.85rem', padding: '8px 16px' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={loading}
                  className="btn-primary"
                  style={{ 
                    fontSize: '0.85rem', 
                    padding: '8px 18px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px',
                    opacity: loading ? 0.7 : 1
                  }}
                >
                  {loading ? (
                    <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', display: 'inline-block' }} />
                  ) : (
                    <>
                      <Key size={14} />
                      <span>Update Password</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
