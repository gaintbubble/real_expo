"use client";

import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, User, Shield } from 'lucide-react';
import { changePassword } from '../actions/auth';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [user, setUser] = useState<any>(null);
  
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem('nexus_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch (e) {
        console.error(e);
      }
    } else {
      router.push('/login');
    }
  }, [router]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ text: 'All fields are required', type: 'error' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ text: 'New passwords do not match', type: 'error' });
      return;
    }

    if (newPassword.length < 5) {
      setMessage({ text: 'New password must be at least 5 characters long', type: 'error' });
      return;
    }

    if (!user || !user.id) {
      setMessage({ text: 'User not found. Please log in again.', type: 'error' });
      return;
    }

    setLoading(true);
    const res = await changePassword(user.id, currentPassword, newPassword);
    setLoading(false);

    if (res.success) {
      setMessage({ text: 'Password updated successfully', type: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setMessage({ text: res.message || 'Failed to update password', type: 'error' });
    }
  };

  const inputStyle = { 
    width: '100%', 
    padding: '12px 14px 12px 40px', 
    borderRadius: '8px', 
    border: '1px solid var(--border-color)', 
    background: 'var(--bg-tertiary)', 
    color: 'white', 
    outline: 'none',
    fontSize: '0.95rem',
    transition: 'all 0.2s ease'
  };

  if (!user) return <div style={{ padding: '2rem' }}>Loading...</div>;

  return (
    <div className="dashboard-container" style={{ maxWidth: '800px', margin: '0 auto', paddingTop: '2rem' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <SettingsIcon size={28} style={{ color: 'var(--accent-primary)' }} />
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Settings</h2>
      </div>

      <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '1fr' }}>
        {/* Profile Summary Card */}
        <div className="scanner-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <div style={{ 
              width: '56px', height: '56px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold', color: 'white'
            }}>
              {user.name ? user.name.charAt(0).toUpperCase() : <User />}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{user.name}</h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>@{user.username}</p>
            </div>
            {user.username === 'admin' && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139, 92, 246, 0.15)', color: '#c4b5fd', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 600 }}>
                <Shield size={16} /> Administrator
              </div>
            )}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
            <div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Mobile Number</p>
              <p style={{ margin: '4px 0 0 0', fontWeight: 500 }}>{user.mobileNo || 'Not provided'}</p>
            </div>
            <div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Modules Access</p>
              <p style={{ margin: '4px 0 0 0', fontWeight: 500 }}>{user.modules ? user.modules.length : 0} modules</p>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="scanner-card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Key size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Change Password</h3>
          </div>

          {message.text && (
            <div style={{ 
              padding: '12px 16px', 
              borderRadius: '8px', 
              marginBottom: '1.5rem', 
              background: message.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
              color: message.type === 'error' ? 'var(--danger)' : 'var(--success)',
              border: `1px solid ${message.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
              fontSize: '0.9rem'
            }}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Current Password
              </label>
              <div style={{ position: 'relative' }}>
                <Key size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input 
                  type="password" 
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                New Password
              </label>
              <div style={{ position: 'relative' }}>
                <Key size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input 
                  type="password" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Confirm New Password
              </label>
              <div style={{ position: 'relative' }}>
                <Key size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  style={inputStyle}
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="scanner-btn"
              style={{ 
                marginTop: '0.5rem',
                padding: '12px',
                borderRadius: '8px',
                width: 'auto',
                alignSelf: 'flex-start',
                minWidth: '150px',
                opacity: loading ? 0.7 : 1
              }}
            >
              {loading ? (
                <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }}></div>
              ) : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
