"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, User } from 'lucide-react';
import { verifyUser } from '../actions/auth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await verifyUser(username.trim(), password);
    setLoading(false);
    
    if (res.success && res.user) {
      localStorage.setItem('nexus_user', JSON.stringify(res.user));
      router.push('/');
    } else {
      alert(res.message);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      width: '100vw', 
      alignItems: 'center', 
      justifyContent: 'center', 
      backgroundImage: 'radial-gradient(circle at 15% 50%, rgba(59, 130, 246, 0.08), transparent 25%), radial-gradient(circle at 85% 30%, rgba(139, 92, 246, 0.08), transparent 25%)',
      backgroundColor: 'var(--bg-primary)'
    }}>
      <div className="scanner-card" style={{ width: '100%', maxWidth: '420px', margin: '0 1rem', animation: 'scaleIn 0.4s ease-out' }}>
        
        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <div style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            width: '64px', 
            height: '64px', 
            borderRadius: '16px', 
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', 
            color: 'white', 
            fontSize: '1.5rem', 
            fontWeight: 'bold', 
            marginBottom: '1rem',
            boxShadow: '0 8px 25px rgba(59, 130, 246, 0.4)'
          }}>
            AL
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>ASRAM Labs</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontSize: '0.95rem' }}>Sign in to continue</p>
        </div>

        <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div style={{ textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Username
            </label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                style={{ 
                  width: '100%', 
                  padding: '14px 14px 14px 44px', 
                  borderRadius: '12px', 
                  border: '2px solid var(--bg-tertiary)', 
                  background: 'rgba(15, 23, 42, 0.6)', 
                  color: 'white', 
                  outline: 'none', 
                  fontSize: '1rem',
                  transition: 'all 0.3s ease'
                }}
                required
              />
            </div>
          </div>

          <div style={{ textAlign: 'left' }}>
            <label style={{ display: 'flex', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', justifyContent: 'space-between' }}>
              <span>Password</span>
              <a href="#" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '0.8rem' }}>Forgot?</a>
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                style={{ 
                  width: '100%', 
                  padding: '14px 14px 14px 44px', 
                  borderRadius: '12px', 
                  border: '2px solid var(--bg-tertiary)', 
                  background: 'rgba(15, 23, 42, 0.6)', 
                  color: 'white', 
                  outline: 'none', 
                  fontSize: '1rem',
                  transition: 'all 0.3s ease'
                }}
                required
              />
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="scanner-btn"
            style={{ 
              width: '100%', 
              padding: '14px', 
              marginTop: '0.5rem', 
              borderRadius: '12px',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? (
              <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></div>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
        
      </div>
    </div>
  );
}
