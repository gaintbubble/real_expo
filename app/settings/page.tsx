"use client";

import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, User, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
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

  if (!user) return <div style={{ padding: '2rem' }}>Loading...</div>;

  return (
    <div className="dashboard-container" style={{ maxWidth: '800px', margin: '0 auto', paddingTop: '2rem' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <SettingsIcon size={28} style={{ color: 'var(--accent-primary)' }} />
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Account Profile</h2>
      </div>

      <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '1fr' }}>
        {/* Profile Summary Card */}
        <div className="scanner-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1.25rem' }}>
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
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginTop: '0.5rem' }}>
            <div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Mobile Number</p>
              <p style={{ margin: '4px 0 0 0', fontWeight: 500 }}>{user.mobileNo || 'Not provided'}</p>
            </div>
            <div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Modules Access</p>
              <p style={{ margin: '4px 0 0 0', fontWeight: 500 }}>{user.modules ? user.modules.length : 0} modules</p>
            </div>
            {user.departments && user.departments.length > 0 && (
              <div>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Assigned Departments</p>
                <p style={{ margin: '4px 0 0 0', fontWeight: 500 }}>{user.departments.length} department(s)</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
