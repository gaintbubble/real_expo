"use client";

import React, { useState, useEffect } from 'react';
import { getUsers, addUser, editUser, removeUser, resetPassword } from '../actions/users';
import { getDepartments } from '../actions/departments';
import { Trash2, Edit2, X, User as UserIcon, Key } from 'lucide-react';

interface Department {
  id: string;
  name: string;
}

interface User {
  id: string;
  username: string;
  name: string;
  mobileNo: string | null;
  departments: string[];
  modules: string[];
}

const AVAILABLE_MODULES = [
  'Dashboard',
  'Samples',
  'Patients',
  'Departments',
  'Test Config',
  'Users',
  'Settings'
];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  
  // Permissions state
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);

  const loadData = async () => {
    const data = await getUsers();
    setUsers(data as User[]);
    
    const depts = await getDepartments();
    setAllDepartments(depts as Department[]);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !name.trim()) return;
    
    setLoading(true);
    let res;
    if (editingId) {
      res = await editUser(
        editingId, 
        username.trim(), 
        name.trim(), 
        mobileNo.trim() || null,
        selectedDepts,
        selectedModules
      );
    } else {
      res = await addUser(
        username.trim(), 
        name.trim(), 
        mobileNo.trim() || null,
        selectedDepts,
        selectedModules
      );
    }

    if (res.success) {
      resetForm();
      await loadData();
    } else {
      alert(res.message);
    }
    setLoading(false);
  };

  const resetForm = () => {
    setEditingId(null);
    setUsername('');
    setName('');
    setMobileNo('');
    setSelectedDepts([]);
    setSelectedModules([]);
  };

  const handleEditClick = (user: User) => {
    setEditingId(user.id);
    setUsername(user.username);
    setName(user.name);
    setMobileNo(user.mobileNo || '');
    setSelectedDepts(user.departments || []);
    setSelectedModules(user.modules || []);
  };

  const handleRemove = async (id: string) => {
    if (confirm("Are you sure you want to remove this user?")) {
      const res = await removeUser(id);
      if (res.success) {
        if (editingId === id) resetForm();
        await loadData();
      } else {
        alert(res.message);
      }
    }
  };

  const handleResetPassword = async (id: string) => {
    if (confirm("Are you sure you want to reset this user's password to the default ('asram')?")) {
      setLoading(true);
      const res = await resetPassword(id);
      alert(res.message);
      setLoading(false);
    }
  };

  const toggleDept = (deptId: string) => {
    setSelectedDepts(prev => 
      prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]
    );
  };

  const toggleModule = (mod: string) => {
    setSelectedModules(prev => 
      prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]
    );
  };

  const inputStyle = { 
    width: '100%', 
    padding: '0 8px', 
    borderRadius: '4px', 
    border: '1px solid var(--border-color)', 
    background: 'var(--bg-tertiary)', 
    color: 'white', 
    outline: 'none',
    fontSize: '13px'
  };

  const checkboxStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    marginBottom: '4px'
  };

  return (
    <div className="dashboard-container">
      <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <UserIcon size={24} style={{ color: 'var(--accent-primary)' }} />
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>User Management</h2>
      </div>

      <div className="scanner-card" style={{ marginBottom: '2rem', padding: '1.5rem', alignItems: 'flex-start', border: editingId ? '1px solid var(--warning)' : '1px solid var(--glass-border)' }}>
        <form onSubmit={handleAddOrUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
          
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: editingId ? 'var(--warning)' : 'var(--text-secondary)' }}>
                {editingId ? 'EDITING: Username' : 'Username'}
              </label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. jdoe123"
                style={{ ...inputStyle, height: '32px' }}
                required
              />
            </div>

            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Full Name</label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                style={{ ...inputStyle, height: '32px' }}
                required
              />
            </div>

            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Mobile No.</label>
              <input 
                type="text" 
                value={mobileNo}
                onChange={(e) => setMobileNo(e.target.value)}
                placeholder="e.g. 1234567890"
                style={{ ...inputStyle, height: '32px' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <div style={{ flex: '1 1 250px' }}>
              <label style={{ display: 'block', marginBottom: '0.8rem', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Department Permissions
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem', background: 'var(--bg-tertiary)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                {allDepartments.length === 0 ? (
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No departments available</span>
                ) : (
                  allDepartments.map(dept => (
                    <label key={dept.id} style={checkboxStyle}>
                      <input 
                        type="checkbox" 
                        checked={selectedDepts.includes(dept.id)}
                        onChange={() => toggleDept(dept.id)}
                        style={{ cursor: 'pointer' }}
                      />
                      {dept.name}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div style={{ flex: '1 1 250px' }}>
              <label style={{ display: 'block', marginBottom: '0.8rem', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Module Permissions
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem', background: 'var(--bg-tertiary)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                {AVAILABLE_MODULES.map(mod => (
                  <label key={mod} style={checkboxStyle}>
                    <input 
                      type="checkbox" 
                      checked={selectedModules.includes(mod)}
                      onChange={() => toggleModule(mod)}
                      style={{ cursor: 'pointer' }}
                    />
                    {mod}
                  </label>
                ))}
              </div>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button 
              type="submit"
              disabled={loading}
              style={{ padding: '0 16px', height: '32px', borderRadius: '4px', border: 'none', background: editingId ? 'var(--warning)' : 'var(--accent-primary)', color: editingId ? '#000' : 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap' }}
            >
              {loading ? 'Saving...' : (editingId ? 'Update User' : 'Create User')}
            </button>
            
            {editingId && (
              <button 
                type="button"
                onClick={resetForm}
                disabled={loading}
                style={{ padding: '0 12px', height: '32px', borderRadius: '4px', border: 'none', background: 'var(--bg-tertiary)', color: 'white', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                title="Cancel Edit"
              >
                <X size={16} /> Cancel Edit
              </button>
            )}
          </div>
        </form>
      </div>

      <section className="samples-section">
        <div className="table-container" style={{ overflowX: 'auto' }}>
          <table className="samples-table" style={{ fontSize: '14px', width: '100%' }}>
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Mobile No.</th>
                <th>Depts</th>
                <th>Modules</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    No users found. Add one above.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className={`table-row ${editingId === user.id ? 'status-waiting' : ''}`}>
                    <td className="info-value">{user.username}</td>
                    <td>{user.name}</td>
                    <td className="text-secondary">{user.mobileNo || '--'}</td>
                    <td>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {user.departments.length} depts
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {user.modules.length} mods
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button 
                        onClick={() => handleEditClick(user)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '6px', marginRight: '4px' }}
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleRemove(user.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '6px' }}
                        title="Remove"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleResetPassword(user.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--warning)', cursor: 'pointer', padding: '6px' }}
                        title="Reset Password to Default"
                      >
                        <Key size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
