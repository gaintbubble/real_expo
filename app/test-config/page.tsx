"use client";

import React, { useState, useEffect, useRef } from 'react';
import { getTestConfigs, addTestConfig, removeTestConfig, bulkAddTestConfigs, updateTestConfig, clearAllTestConfigs } from '../actions/testConfigs';
import { getDepartments, addDepartment } from '../actions/departments';
import { ClipboardList, Trash2, Upload, Edit2, X } from 'lucide-react';
import * as XLSX from 'xlsx';

interface Department {
  id: string;
  name: string;
}

interface TestConfig {
  id: string;
  testName: string;
  serviceCd: string | null;
  shortName: string | null;
  departmentId: string;
  department: Department;
  intervalTime: number;
  intervalTimeVerified: number | null;
}

export default function TestConfigPage() {
  const [configs, setConfigs] = useState<TestConfig[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testName, setTestName] = useState('');
  const [serviceCd, setServiceCd] = useState('');
  const [shortName, setShortName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [intervalTime, setIntervalTime] = useState('');
  const [intervalTimeVerified, setIntervalTimeVerified] = useState('');

  const loadData = async () => {
    const depts = await getDepartments();
    setDepartments(depts);
    const confs = await getTestConfigs();
    // @ts-ignore
    setConfigs(confs);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testName.trim() || !departmentId || !intervalTime) return;
    
    setLoading(true);
    const payload = {
      testName: testName.trim(),
      serviceCd: serviceCd.trim(),
      shortName: shortName.trim(),
      departmentId,
      intervalTime: parseInt(intervalTime, 10),
      intervalTimeVerified: intervalTimeVerified ? parseInt(intervalTimeVerified, 10) : undefined
    };

    let res;
    if (editingId) {
      res = await updateTestConfig(editingId, payload);
    } else {
      res = await addTestConfig(payload);
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
    setTestName('');
    setServiceCd('');
    setShortName('');
    setIntervalTime('');
    setIntervalTimeVerified('');
    // keep department selected
  };

  const handleEditClick = (config: TestConfig) => {
    setEditingId(config.id);
    setTestName(config.testName);
    setServiceCd(config.serviceCd || '');
    setShortName(config.shortName || '');
    setDepartmentId(config.departmentId);
    setIntervalTime(config.intervalTime.toString());
    setIntervalTimeVerified(config.intervalTimeVerified?.toString() || '');
  };

  const handleRemove = async (id: string) => {
    if (confirm("Are you sure you want to remove this test configuration?")) {
      const res = await removeTestConfig(id);
      if (res.success) {
        if (editingId === id) resetForm();
        await loadData();
      } else {
        alert(res.message);
      }
    }
  };

  const handleClearAll = async () => {
    if (confirm("Are you sure you want to completely remove ALL test configurations? This cannot be undone.")) {
      setLoading(true);
      const res = await clearAllTestConfigs();
      if (res.success) {
        if (editingId) resetForm();
        await loadData();
      } else {
        alert(res.message);
      }
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const arrayBuffer = evt.target?.result;
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        const configsToAdd = [];
        let currentDepts = [...departments];

        for (const row of data as any[]) {
          const serviceName = row['SERVICE_NAME'] || row['Test Name'] || row['testName'];
          const groupName = row['SERVICE_GROUP_NAME'] || row['Department'];
          const serviceCd = row['SERVICE_CD'] || row['Service Code'];
          const shortName = row['Short_Name'] || row['Short Name'];
          const resultMins = row['Interval Time for Result Done (Minutes)'] || row['Result Mins'] || row['intervalTime'];
          const verifiedMins = row['Interval Time for Verified (Minutes)'] || row['Verified Mins'];

          if (!serviceName || !groupName || !resultMins) continue;

          let deptId = currentDepts.find(d => d.name.toLowerCase() === String(groupName).trim().toLowerCase())?.id;
          if (!deptId) {
             const res = await addDepartment(String(groupName).trim());
             if (res.success && res.department) {
                deptId = res.department.id;
                currentDepts.push(res.department);
             }
          }

          const parsedResultMins = parseInt(String(resultMins), 10);
          const parsedVerifiedMins = verifiedMins ? parseInt(String(verifiedMins), 10) : undefined;

          if (deptId && !isNaN(parsedResultMins)) {
             configsToAdd.push({
               testName: String(serviceName).trim(),
               serviceCd: serviceCd ? String(serviceCd).trim() : undefined,
               shortName: shortName ? String(shortName).trim() : '',
               departmentId: deptId,
               intervalTime: parsedResultMins,
               intervalTimeVerified: !isNaN(parsedVerifiedMins as number) ? parsedVerifiedMins : undefined
             });
          }
        }

        if (configsToAdd.length > 0) {
          const res = await bulkAddTestConfigs(configsToAdd);
          alert(res.message);
          await loadData();
        } else {
          alert("No valid rows found. Ensure Excel has columns: SERVICE_NAME, SERVICE_GROUP_NAME, Interval Time for Result Done (Minutes)");
        }
      } catch (err: any) {
        console.error(err);
        alert("Error parsing Excel file: " + (err.message || "Unknown error"));
      }
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  const inputStyle = { 
    width: '100%', 
    padding: '0 6px', 
    borderRadius: '4px', 
    border: '1px solid var(--border-color)', 
    background: 'var(--bg-tertiary)', 
    color: 'white', 
    outline: 'none',
    fontSize: '12px'
  };

  return (
    <div className="dashboard-container">
      <div className="scanner-card" style={{ marginBottom: '2rem', padding: '1.5rem', alignItems: 'flex-start', overflowX: 'auto', border: editingId ? '1px solid var(--warning)' : '1px solid var(--glass-border)' }}>
        <form onSubmit={handleAddOrUpdate} style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem', width: '100%', alignItems: 'flex-end', flexWrap: 'nowrap', minWidth: '800px' }}>
          
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', color: editingId ? 'var(--warning)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {editingId ? 'EDITING: SERVICE_NAME' : 'SERVICE_NAME'}
            </label>
            <input 
              type="text" 
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              placeholder="Name..."
              style={{ ...inputStyle, height: '20px' }}
              required
            />
          </div>

          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>SERVICE_GROUP</label>
            <select 
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              style={{ ...inputStyle, height: '20px', cursor: 'pointer', padding: '0 2px' }}
              required
            >
              <option value="">Select...</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '0 1 100px' }}>
            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>SERVICE_CD</label>
            <input 
              type="text" 
              value={serviceCd}
              onChange={(e) => setServiceCd(e.target.value)}
              placeholder="CD..."
              style={{ ...inputStyle, height: '20px' }}
            />
          </div>

          <div style={{ flex: '0 1 100px' }}>
            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Short_Name</label>
            <input 
              type="text" 
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="Short..."
              style={{ ...inputStyle, height: '20px' }}
            />
          </div>
          
          <div style={{ flex: '0 1 100px' }}>
            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Result Mins</label>
            <input 
              type="number" 
              value={intervalTime}
              onChange={(e) => setIntervalTime(e.target.value)}
              placeholder="e.g. 30"
              style={{ ...inputStyle, height: '20px' }}
              min="1"
              required
            />
          </div>

          <div style={{ flex: '0 1 100px' }}>
            <label style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Verified Mins</label>
            <input 
              type="number" 
              value={intervalTimeVerified}
              onChange={(e) => setIntervalTimeVerified(e.target.value)}
              placeholder="e.g. 45"
              style={{ ...inputStyle, height: '20px' }}
              min="1"
            />
          </div>
          
          <div style={{ paddingBottom: '0', display: 'flex', gap: '0.5rem' }}>
            <button 
              type="submit"
              disabled={loading}
              style={{ padding: '0 12px', height: '20px', borderRadius: '4px', border: 'none', background: editingId ? 'var(--warning)' : 'var(--accent-primary)', color: editingId ? '#000' : 'white', fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap' }}
            >
              {loading ? 'Saving...' : (editingId ? 'Update Config' : 'Add Config')}
            </button>
            
            {editingId && (
              <button 
                type="button"
                onClick={resetForm}
                disabled={loading}
                style={{ padding: '0 8px', height: '20px', borderRadius: '4px', border: 'none', background: 'var(--bg-tertiary)', color: 'white', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                title="Cancel Edit"
              >
                <X size={12} />
              </button>
            )}

            {!editingId && (
              <label 
                style={{ padding: '0 12px', height: '20px', borderRadius: '4px', border: 'none', background: 'var(--success)', color: 'white', fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Upload size={12} />
                {loading ? '...' : 'Upload Excel'}
                <input 
                  type="file" 
                  accept=".xlsx, .xls" 
                  onChange={handleFileUpload} 
                  style={{ display: 'none' }} 
                  ref={fileInputRef}
                />
              </label>
            )}

            {!editingId && configs.length > 0 && (
              <button 
                type="button"
                onClick={handleClearAll}
                disabled={loading}
                style={{ padding: '0 12px', height: '20px', borderRadius: '4px', border: 'none', background: 'var(--danger)', color: 'white', fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Trash2 size={12} />
                Delete All
              </button>
            )}
          </div>
        </form>
      </div>

      <section className="samples-section">
        <div className="table-container" style={{ overflowX: 'auto' }}>
          <table className="samples-table" style={{ fontSize: '13px' }}>
            <thead>
              <tr>
                <th>SERVICE_NAME</th>
                <th>SERVICE_GROUP_NAME</th>
                <th>SERVICE_CD</th>
                <th>Short_Name</th>
                <th style={{ textAlign: 'center' }}>Result Done (Mins)</th>
                <th style={{ textAlign: 'center' }}>Verified (Mins)</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {configs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    No test configurations found. Add one above or upload an Excel file.
                  </td>
                </tr>
              ) : (
                configs.map((config) => (
                  <tr key={config.id} className={`table-row ${editingId === config.id ? 'status-waiting' : ''}`}>
                    <td className="info-value">{config.testName}</td>
                    <td>
                      <span className="status-badge" style={{ background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd', fontSize: '11px', padding: '2px 6px' }}>
                        {config.department?.name || 'Unknown'}
                      </span>
                    </td>
                    <td className="text-secondary">{config.serviceCd || '--'}</td>
                    <td className="text-secondary">{config.shortName || '--'}</td>
                    <td className="info-value" style={{ textAlign: 'center' }}>{config.intervalTime}</td>
                    <td className="info-value" style={{ textAlign: 'center' }}>{config.intervalTimeVerified || '--'}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button 
                        onClick={() => handleEditClick(config)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '4px', marginRight: '4px' }}
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleRemove(config.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px' }}
                        title="Remove"
                      >
                        <Trash2 size={16} />
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
