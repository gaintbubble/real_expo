"use client";

import React, { useState, useEffect } from 'react';
import { getDepartments, addDepartment, removeDepartment, editDepartment } from '../actions/departments';
import { Building2, Trash2, Pencil } from 'lucide-react';

interface Department {
  id: string;
  name: string;
  triggerTime?: number | null;
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [triggerTimeInput, setTriggerTimeInput] = useState('');
  const [triggerTimeEnabled, setTriggerTimeEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadDepartments = async () => {
    const data = await getDepartments();
    setDepartments(data);
  };

  useEffect(() => {
    loadDepartments();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    setLoading(true);
    const triggerTimeValue = (triggerTimeEnabled && triggerTimeInput.trim()) ? parseInt(triggerTimeInput.trim()) : null;
    
    if (editingId) {
      const res = await editDepartment(
        editingId,
        nameInput.trim(),
        isNaN(triggerTimeValue as number) ? null : triggerTimeValue
      );
      if (res.success) {
        setEditingId(null);
        setNameInput('');
        setTriggerTimeInput('');
        setTriggerTimeEnabled(false);
        await loadDepartments();
      } else {
        alert(res.message);
      }
    } else {
      const res = await addDepartment(
        nameInput.trim(),
        isNaN(triggerTimeValue as number) ? undefined : triggerTimeValue
      );
      if (res.success) {
        setNameInput('');
        setTriggerTimeInput('');
        setTriggerTimeEnabled(false);
        await loadDepartments();
      } else {
        alert(res.message);
      }
    }
    setLoading(false);
  };

  const handleEditClick = (dept: Department) => {
    setEditingId(dept.id);
    setNameInput(dept.name);
    setTriggerTimeInput(dept.triggerTime ? dept.triggerTime.toString() : '');
    setTriggerTimeEnabled(dept.triggerTime != null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setNameInput('');
    setTriggerTimeInput('');
    setTriggerTimeEnabled(false);
  };

  const handleRemove = async (id: string) => {
    if (confirm("Are you sure you want to remove this department?")) {
      const res = await removeDepartment(id);
      if (res.success) {
        await loadDepartments();
      } else {
        alert(res.message);
      }
    }
  };

  return (
    <div className="dashboard-container">
      <div className="header">
        <div className="logo-section">
          <h1>Departments</h1>
          <p>Manage laboratory departments</p>
        </div>
      </div>

      <div className="scanner-card" style={{ marginBottom: '2rem', padding: '1.5rem', alignItems: 'flex-start' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
          {editingId ? 'Edit Department' : 'Add New Department'}
        </h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '1rem', width: '100%', flexWrap: 'wrap' }}>
          <input 
            type="text" 
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="e.g. Haematology, Clinical Pathology"
            style={{ flex: 2, minWidth: '200px', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'white', outline: 'none' }}
            disabled={loading}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--bg-tertiary)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
              <input 
                type="checkbox" 
                checked={triggerTimeEnabled}
                onChange={(e) => setTriggerTimeEnabled(e.target.checked)}
                disabled={loading}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              Trigger Time
            </label>
            {triggerTimeEnabled && (
              <input 
                type="number" 
                value={triggerTimeInput}
                onChange={(e) => setTriggerTimeInput(e.target.value)}
                placeholder="Mins"
                style={{ width: '80px', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'white', outline: 'none' }}
                disabled={loading}
              />
            )}
          </div>
          <button 
            type="submit"
            disabled={loading}
            style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none', background: 'var(--accent-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
          >
            {loading ? (editingId ? 'Saving...' : 'Adding...') : (editingId ? 'Save Changes' : 'Add Department')}
          </button>
          {editingId && (
            <button 
              type="button"
              onClick={handleCancelEdit}
              disabled={loading}
              style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
            >
              Cancel
            </button>
          )}
        </form>
      </div>

      <section className="samples-section">
        <div className="section-header">
          <h2 className="section-title">
            <Building2 size={24} />
            Department List
          </h2>
          <span style={{ color: 'var(--text-secondary)' }}>{departments.length} departments</span>
        </div>

        <div className="table-container">
          <table className="samples-table">
            <thead>
              <tr>
                <th style={{ width: '60px', textAlign: 'center' }}>No.</th>
                <th>Department Name</th>
                <th style={{ width: '150px', textAlign: 'center' }}>Trigger Time</th>
                <th style={{ width: '100px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    No departments found. Add one above.
                  </td>
                </tr>
              ) : (
                departments.map((dept, idx) => (
                  <tr key={dept.id} className="table-row">
                    <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                    <td className="info-value">{dept.name}</td>
                    <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                      {dept.triggerTime ? `${dept.triggerTime} mins` : '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        onClick={() => handleEditClick(dept)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '4px', marginRight: '8px' }}
                        title="Edit"
                      >
                        <Pencil size={18} />
                      </button>
                      <button 
                        onClick={() => handleRemove(dept.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px' }}
                        title="Remove"
                      >
                        <Trash2 size={18} />
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
