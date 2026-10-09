"use client";

import React, { useState, useRef, useEffect } from 'react';
import { saveBarcodeToDatabase, getAllTrackedSamples, clearAllSamples, deleteSample, updateSampleBarcode, markSampleReceived, extendSampleTime, simulateFalseTrigger } from './actions';
import { getDepartments } from './actions/departments';
import { DatePicker } from './components/DatePicker';
import { Edit2, Trash2, Barcode, CheckCircle, Volume2, VolumeX } from 'lucide-react';

interface Sample {
  id: string;
  barcode: string;
  patient: string;
  test: string;
  serviceCd: string;
  status: string;
  entryDate: string;
  entryTime: string;
  receivedDate: string;
  receivedTime: string;
  resultDate: string;
  resultTime: string;
  target: string;
  delayPercent: number;
  departments?: string[];
  isOverdue?: boolean;
  isOverdueAfterExtraTime?: boolean;
  testDetails?: any[];
  isTriggerOverdue?: boolean;
  isResultOverdue?: boolean;
  isVerificationOverdue?: boolean;
}

export default function Dashboard() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [isScanning, setIsScanning] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [deleteModal, setDeleteModal] = useState<string | null>(null);
  const [receiveModal, setReceiveModal] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{ id: string, barcode: string } | null>(null);
  const [editInput, setEditInput] = useState('');
  const [departments, setDepartments] = useState<{id: string, name: string}[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [extendModal, setExtendModal] = useState<{ id: string, barcode: string, testDetails: any[] } | null>(null);
  const [extendSelections, setExtendSelections] = useState<string[]>([]);
  const [extendMins, setExtendMins] = useState<number>(30);
  const [extendReason, setExtendReason] = useState<string>('');
  const [mutedSamples, setMutedSamples] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleSampleMute = (id: string) => {
    setMutedSamples(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const today = new Date();
    setSelectedDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
    
    const loadDepts = async () => {
      const depts = await getDepartments();
      const stored = localStorage.getItem('nexus_user');
      let filteredDepts = depts;
      let currentUser: any = null;
      
      if (stored) {
        try {
          currentUser = JSON.parse(stored);
          setUser(currentUser);
          if (currentUser.username !== 'admin' && currentUser.departments && currentUser.departments.length > 0) {
            filteredDepts = depts.filter((d: any) => currentUser.departments.includes(d.id));
          } else if (currentUser.username !== 'admin' && (!currentUser.departments || currentUser.departments.length === 0)) {
            filteredDepts = []; // If regular user has no departments, show none
          }
        } catch (e) {
          console.error(e);
        }
      }
      
      setDepartments(filteredDepts);
      if (filteredDepts.length > 0) {
        let initialTab = filteredDepts[0].name;
        if (currentUser) {
          const defaultTab = localStorage.getItem(`nexus_default_dept_${currentUser.username}`);
          if (defaultTab && filteredDepts.some((d: any) => d.name === defaultTab)) {
            initialTab = defaultTab;
          }
        }
        setActiveTab(initialTab);
      }
    };
    loadDepts();
  }, []);

  const handleSetDefaultDept = () => {
    if (user && activeTab) {
      localStorage.setItem(`nexus_default_dept_${user.username}`, activeTab);
      alert(`"${activeTab}" has been set as your default department.`);
    }
  };

  useEffect(() => {
    const loadRealData = async () => {
      try {
        const dbSamples = await getAllTrackedSamples();
        if (!Array.isArray(dbSamples)) return;
        
        const formattedSamples: Sample[] = dbSamples.map((s: any) => {
          const now = new Date();
          let isTriggerOverdue = false;
          let isResultOverdue = false;
          let isVerificationOverdue = false;

          const createdAtDate = s.createdAt ? new Date(s.createdAt) : null;
          const receivedDateObj = s.receivedTime ? new Date(s.receivedTime) : null;
          const resultDateObj = s.resultTime ? new Date(s.resultTime) : null;

          const statusLower = (s.currentStatus || '').toLowerCase();

          // 1. Trigger Time Monitoring
          if (s.triggerTime != null && receivedDateObj) {
            const limit = new Date(receivedDateObj.getTime() + s.triggerTime * 60000);
            if (now > limit && statusLower.includes('received')) {
              isTriggerOverdue = true;
            }
          }

          // 2. Result Done (Mins) Monitoring
          if (s.intervalTime != null && createdAtDate) {
            const limit = new Date(createdAtDate.getTime() + s.intervalTime * 60000);
            if (now > limit && statusLower.includes('received')) {
              isResultOverdue = true;
            }
          }

          // 3. Verified (Mins) Monitoring
          if (s.intervalTimeVerified != null && resultDateObj) {
            const limit = new Date(resultDateObj.getTime() + s.intervalTimeVerified * 60000);
            if (now > limit && statusLower.includes('result done')) {
              isVerificationOverdue = true;
            }
          }

          return {
            id: s.id,
            barcode: s.barcode,
            patient: s.patientName || '--',
            test: s.displayTestName || s.testName || 'Waiting...',
            testDetails: s.testDetails ? (() => { try { return JSON.parse(s.testDetails); } catch { return []; } })() : [],
            serviceCd: s.serviceCd || '--',
            status: s.currentStatus,
            entryDate: s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--',
            entryTime: s.createdAt ? new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--',
            receivedDate: s.receivedTime ? new Date(s.receivedTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--',
            receivedTime: s.receivedTime ? new Date(s.receivedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--',
            resultDate: s.resultTime ? new Date(s.resultTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--',
            resultTime: s.resultTime ? new Date(s.resultTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--',
            target: '--',
            delayPercent: 0,
            departments: s.departments || [],
            isOverdue: !s.isCompleted && (
              (s.expectedEndTime && new Date() > new Date(s.expectedEndTime)) || 
              (!s.expectedEndTime && s.receivedTime && new Date().getTime() - new Date(s.receivedTime).getTime() > 15 * 60000)
            ),
            isOverdueAfterExtraTime: !s.isCompleted && (
              (s.expectedEndTime && new Date() > new Date(s.expectedEndTime)) || 
              (!s.expectedEndTime && s.receivedTime && new Date().getTime() - new Date(s.receivedTime).getTime() > 15 * 60000)
            ) && (s.testDetails ? (() => { try { return JSON.parse(s.testDetails).some((t: any) => t.extraTime && t.extraTime > 0); } catch { return false; } })() : false),
            isTriggerOverdue,
            isResultOverdue,
            isVerificationOverdue
          };
        });
        setSamples((prev) => {
          const tempSamples = prev.filter(s => s.id.startsWith('temp-'));
          const tempBarcodes = new Set(tempSamples.map(s => s.barcode));
          const filteredFormatted = formattedSamples.filter(f => !tempBarcodes.has(f.barcode));
          return [...tempSamples, ...filteredFormatted];
        });
      } catch (error) {
        console.warn("Polling error (Server might be restarting):", error);
      }
    };
    
    // Initial load
    loadRealData();
    
    // Poll every 5 seconds to automatically show updates from the extension
    const intervalId = setInterval(loadRealData, 5000);
    
    if (inputRef.current) {
      inputRef.current.focus();
    }
    
    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, []);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentInput = barcodeInput.trim();
    if (!currentInput) return;
    
    // Clear input immediately for next scan instantly
    setBarcodeInput('');
    
    // Optimistic UI update
    const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substring(7);
    const optimisticSample: Sample = {
      id: tempId,
      barcode: currentInput,
      patient: 'Loading...',
      test: 'Loading...',
      serviceCd: '--',
      status: 'Saving...',
      entryDate: '--',
      entryTime: '--',
      receivedDate: '--',
      receivedTime: '--',
      resultDate: '--',
      resultTime: '--',
      target: '--',
      delayPercent: 0,
      departments: [],
      isOverdue: false,
      isOverdueAfterExtraTime: false,
    };
    
    setSamples((prev) => [optimisticSample, ...prev]);
    
    // Focus back immediately just in case
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 10);
    
    setIsScanning(true);
    
    try {
      const res = await fetch('/api/save-barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: currentInput, activeTab })
      });
      const response = await res.json();
      
      if (response.success && response.sample) {
        const newSample: Sample = {
          id: response.sample.id,
          barcode: response.sample.barcode,
          patient: response.sample.patientName || '--',
          test: ('displayTestName' in response.sample ? (response.sample as { displayTestName?: string }).displayTestName : undefined) || response.sample.testName || 'Waiting...',
          serviceCd: response.sample.serviceCd || '--',
          status: response.sample.currentStatus || 'Pending LIS Search',
          entryDate: response.sample.createdAt ? new Date(response.sample.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--',
          entryTime: response.sample.createdAt ? new Date(response.sample.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--',
          receivedDate: response.sample.receivedTime ? new Date(response.sample.receivedTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--',
          receivedTime: response.sample.receivedTime ? new Date(response.sample.receivedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--',
          resultDate: response.sample.resultTime ? new Date(response.sample.resultTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--',
          resultTime: response.sample.resultTime ? new Date(response.sample.resultTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--',
          target: '--',
          delayPercent: 0,
          departments: ('departments' in response.sample) ? (response.sample as any).departments : [],
          isOverdue: false,
          isOverdueAfterExtraTime: false,
        };
        
        setSamples((prev) => prev.map(s => s.id === tempId ? newSample : s));
      } else {
        // Revert optimistic update on failure
        setSamples((prev) => prev.filter(s => s.id !== tempId));
        alert(response.message || "Failed to save barcode.");
      }
    } catch (error) {
      setSamples((prev) => prev.filter(s => s.id !== tempId));
      console.error(error);
      alert("Error saving barcode.");
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (editModal || deleteModal || receiveModal || extendModal) return;
      const target = e.target as HTMLElement;
      if (target.closest('input') || target.closest('button') || target.closest('select') || target.closest('.custom-datepicker')) {
        return;
      }
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };
    
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [editModal, deleteModal, receiveModal, extendModal]);

  const handleExtendClick = (sample: Sample) => {
    if (!sample.isOverdue || !sample.testDetails || sample.testDetails.length === 0) return;
    setExtendModal({ id: sample.id, barcode: sample.barcode, testDetails: sample.testDetails });
    const pendingTests = sample.testDetails.filter(td => {
      const ds = (td.status || '').toLowerCase();
      return !(ds.includes('approved') || ds.includes('completed') || ds.includes('verified') || ds.includes('done') || ds.includes('authorized') || ds.includes('dispatch'));
    }).map(td => td.name);
    setExtendSelections(pendingTests);
    setExtendMins(30);
    setExtendReason('');
  };

  const confirmExtend = async () => {
    if (extendModal && extendSelections.length > 0 && extendReason.trim()) {
      const res = await extendSampleTime(extendModal.id, extendSelections, extendMins, extendReason.trim());
      if (res.success) {
        // Trigger reload will happen automatically from interval
        setExtendModal(null);
        setTimeout(() => inputRef.current?.focus(), 10);
      } else {
        alert(res.message || "Failed to extend time.");
      }
    } else {
      alert("Please select tests and provide a reason.");
    }
  };

  const playAlarm = () => {
    if (isMuted) return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.5);
      
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn("Audio play failed", e);
    }
  };

  useEffect(() => {
    const hasAlarmSamples = samples.some(s => {
      // Check if user has access to this sample's department
      const hasDeptAccess = user?.username === 'admin' || (s.departments && s.departments.some(dName => departments.some(dept => dept.name === dName)));
      
      return hasDeptAccess && !mutedSamples.has(s.id) && (
        s.status.toLowerCase().includes('collected') || 
        s.status.toLowerCase().includes('batch generated') ||
        s.isOverdueAfterExtraTime
      );
    });

    if (hasAlarmSamples && !isMuted) {
      const interval = setInterval(playAlarm, 3000);
      return () => clearInterval(interval);
    }
  }, [samples, isMuted, mutedSamples]);

  const handleClearAll = async () => {
    if (confirm("Are you sure you want to completely remove all data?")) {
      await clearAllSamples();
      setSamples([]);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteModal(id);
  };

  const confirmDelete = async () => {
    if (deleteModal) {
      const res = await deleteSample(deleteModal);
      if (res.success) {
        setSamples(prev => prev.filter(s => s.id !== deleteModal));
      } else {
        alert(res.message || "Failed to delete.");
      }
      setDeleteModal(null);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  };

  const handleEdit = (id: string, currentBarcode: string) => {
    setEditModal({ id, barcode: currentBarcode });
    setEditInput(currentBarcode);
  };

  const confirmEdit = async () => {
    if (editModal && editInput.trim() && editInput.trim() !== editModal.barcode) {
      const res = await updateSampleBarcode(editModal.id, editInput.trim());
      if (res.success && res.sample) {
        setSamples(prev => prev.map(s => s.id === editModal.id ? { ...s, barcode: editInput.trim() } : s));
      } else {
        alert(res.message || "Failed to update barcode.");
      }
    }
    setEditModal(null);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const confirmMarkReceived = async () => {
    if (!receiveModal) return;
    const id = receiveModal;
    const res = await markSampleReceived(id);
    if (res.success && res.sample) {
      setSamples(prev => prev.map(s => s.id === id ? { 
        ...s, 
        status: res.sample.currentStatus, 
        receivedDate: res.sample.receivedTime ? new Date(res.sample.receivedTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--',
        receivedTime: res.sample.receivedTime ? new Date(res.sample.receivedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'
      } : s));
    } else {
      alert(res.message || "Failed to mark as received.");
    }
    setReceiveModal(null);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const handleFalseTrigger = async (id: string, type: 'trigger' | 'result' | 'verification') => {
    const res = await simulateFalseTrigger(id, type);
    if (res.success && res.sample) {
      setSamples(prev => prev.map(s => {
        if (s.id === id) {
          const testDetails = s.testDetails ? [...s.testDetails] : [];
          if (type === 'verification' && testDetails.length > 0) {
            testDetails.forEach(td => td.status = 'Verified');
          }
          return { 
            ...s, 
            status: res.sample.currentStatus, 
            receivedDate: res.sample.receivedTime ? new Date(res.sample.receivedTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : s.receivedDate,
            receivedTime: res.sample.receivedTime ? new Date(res.sample.receivedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : s.receivedTime,
            resultDate: res.sample.resultTime ? new Date(res.sample.resultTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : s.resultDate,
            resultTime: res.sample.resultTime ? new Date(res.sample.resultTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : s.resultTime,
            testDetails: type === 'verification' ? testDetails : s.testDetails
          };
        }
        return s;
      }));
    } else {
      alert(res.message || "Failed to trigger.");
    }
  };

  const getStatusClass = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('pending')) return 'pending';
    if (s.includes('completed') || s.includes('done') || s.includes('verified')) return 'completed';
    if (s.includes('collected') || s.includes('batch generated')) return 'collected';
    return 'default';
  };

  const getCardStatusClass = (sample: Sample) => {
    const s = sample.status.toLowerCase();
    
    if (sample.isTriggerOverdue) return 'status-overdue';

    if (s.includes('pending')) return 'status-pending';
    if (s.includes('completed') || s.includes('done') || s.includes('verified') || s.includes('approved') || s.includes('dispatch')) return 'status-completed';
    if (s.includes('waiting')) return 'status-waiting';
    if (sample.isOverdueAfterExtraTime) return 'status-overdue-critical';
    if (sample.isOverdue) return 'status-overdue';
    if (s.includes('collected') || s.includes('batch generated')) return 'status-collected';
    return '';
  };

  const filteredSamples = samples.filter(sample => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      sample.barcode.toLowerCase().includes(query) ||
      sample.patient.toLowerCase().includes(query) ||
      sample.test.toLowerCase().includes(query) ||
      sample.status.toLowerCase().includes(query)
    );
    
    let matchesDate = true;
    if (selectedDate) {
      const [year, month, day] = selectedDate.split('-').map(Number);
      const startObj = new Date(year, month - 1, day);
      startObj.setHours(0, 0, 0, 0);
      const endObj = new Date(year, month - 1, day);
      endObj.setHours(23, 59, 59, 999);

      const checkMatch = (dateStr: string) => {
        if (!dateStr || dateStr === '--') return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        d.setHours(12, 0, 0, 0); // Middle of the day to avoid timezone edge cases
        return d >= startObj && d <= endObj;
      };

      matchesDate = checkMatch(sample.receivedDate) || checkMatch(sample.resultDate) || checkMatch(sample.entryDate);
    }

    let matchesDepartment = true;
    if (activeTab) {
      matchesDepartment = sample.departments ? sample.departments.includes(activeTab) : false;
    }

    // Override date filter if they are explicitly searching for something
    if (query && matchesSearch) {
      matchesDate = true;
    }

    let matchesStatusFilter = true;
    if (statusFilter !== 'all') {
      const s = sample.status.toLowerCase();
      const isReceived = sample.receivedDate !== '--' || s.includes('received') || s.includes('result done') || s.includes('verified');

      if (statusFilter === 'not_received') {
        matchesStatusFilter = !isReceived;
      } else if (statusFilter === 'result_not_done') {
        matchesStatusFilter = !!sample.isResultOverdue;
      } else if (statusFilter === 'not_verified') {
        matchesStatusFilter = !!sample.isVerificationOverdue;
      }
    }

    return matchesSearch && matchesDate && matchesDepartment && matchesStatusFilter;
  });

  return (
    <div className="dashboard-container">
      <main>
        <section className="samples-section">
          <div className="section-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '15px' }}>
            <div className="tabs-container" style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '10px', width: '100%', borderBottom: '1px solid var(--border-color)' }}>
              {departments.map(dept => (
                <button 
                  key={dept.id}
                  onClick={() => setActiveTab(dept.name)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: 'none',
                    background: activeTab === dept.name ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                    color: activeTab === dept.name ? 'white' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {dept.name}
                </button>
              ))}
              {departments.length > 1 && (
                <button
                  onClick={handleSetDefaultDept}
                  style={{
                    marginLeft: 'auto',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Make this my default tab"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                  Set as Default
                </button>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <h2 className="section-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                Dashboard Data
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <form onSubmit={handleScan} className="header-search" style={{ width: '180px', padding: '0.25rem 0.5rem', margin: 0, borderColor: 'var(--accent-primary)', background: 'rgba(59, 130, 246, 0.05)' }}>
                  <Barcode size={14} className="search-icon" style={{ color: 'var(--accent-primary)', marginRight: '6px' }} />
                  <input 
                    ref={inputRef}
                    type="text"
                    placeholder="Data Entry or Scan..."
                    className="search-input"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    style={{ fontSize: '0.75rem' }}
                  />
                </form>

                <div className="header-search" style={{ width: '180px', padding: '0.25rem 0.5rem', margin: 0 }}>
                  <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input 
                    type="text"
                    placeholder="Search samples..."
                    className="search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ fontSize: '0.75rem' }}
                  />
                </div>
                <DatePicker 
                  value={selectedDate}
                  onChange={setSelectedDate} 
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="not_received">Not Received</option>
                  <option value="result_not_done">Result Not Done</option>
                  <option value="not_verified">Not Verified</option>
                </select>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>{filteredSamples.length} {filteredSamples.length !== samples.length ? `(of ${samples.length})` : ''} tracked</span>
                  <button 
                    onClick={() => setIsMuted(!isMuted)}
                    style={{ background: 'transparent', color: isMuted ? 'var(--text-secondary)' : 'var(--accent-primary)', border: '1px solid var(--border-color)', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                    title={isMuted ? "Unmute Alarm" : "Mute Alarm"}
                  >
                    {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  <button 
                    onClick={handleClearAll}
                    style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }}>
                    Reset All Data
                  </button>
                </span>
              </div>
            </div>
          </div>

          <div className="table-container">
            <table className="samples-table" style={{ fontSize: '11px' }}>
              <thead>
                <tr>
                  <th style={{ width: '50px', textAlign: 'center' }}>#</th>
                  <th style={{ width: '100px' }}>Barcode</th>
                  <th style={{ width: '15%' }}>Patient</th>
                  <th>Test</th>
                  <th style={{ width: '85px' }}>Entry Date</th>
                  <th style={{ width: '85px' }}>Received</th>
                  <th style={{ width: '85px' }}>Result Time</th>
                  <th style={{ width: '110px' }}>Status</th>
                  <th style={{ width: '120px', textAlign: 'center' }}>Actions</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>Triger</th>
                </tr>
              </thead>
              <tbody>
                {filteredSamples.map((sample, index) => (
                  <tr key={sample.id} className={`table-row ${getCardStatusClass(sample)}`}>
                    <td className="text-secondary" style={{ textAlign: 'center' }}>
                      {filteredSamples.length - index}
                    </td>
                    <td>
                      <span className="barcode-badge">{sample.barcode}</span>
                    </td>
                    <td className="info-value">{sample.patient}</td>
                    <td className="info-value" style={{ whiteSpace: 'normal', minWidth: '200px' }}>
                      {sample.testDetails && sample.testDetails.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {sample.testDetails.map((td: any, i: number) => {
                            const ds = (td.status || '').toLowerCase();
                            const isVerified = ds.includes('verified') || ds.includes('approved') || ds.includes('dispatch') || ds.includes('authorized');
                            const isDone = isVerified || ds.includes('completed') || ds.includes('done');
                            const isPending = !isDone;
                            const isOverdue = isPending && sample.isOverdue;
                            const isOverdueAfterExtraTime = isPending && sample.isOverdueAfterExtraTime;
                            
                            let bg = isDone ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)';
                            let anim = 'none';
                            
                            if (sample.isVerificationOverdue && !isVerified) {
                                anim = 'blinkPurple 1.5s infinite ease-in-out';
                                bg = 'rgba(139, 92, 246, 0.2)'; // Purple background
                            } else if (sample.isResultOverdue && !isDone) {
                                anim = 'blinkAlert 1.5s infinite ease-in-out';
                                bg = 'rgba(245, 158, 11, 0.2)'; // Yellow background
                            } else if (isOverdueAfterExtraTime) {
                                anim = 'blinkRed 1s infinite ease-in-out';
                            } else if (isOverdue) {
                                anim = 'blinkAlert 1s infinite ease-in-out';
                            }

                            return (
                              <span 
                                key={i} 
                                onClick={() => {
                                  if (isOverdue) handleExtendClick(sample);
                                }}
                                style={{ 
                                  background: bg,
                                  color: isDone ? 'var(--success)' : 'var(--text-primary)',
                                  padding: '2px 4px', 
                                  borderRadius: '3px', 
                                  fontSize: '9.5px',
                                  border: isDone ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid var(--border-color)',
                                  animation: anim,
                                  cursor: isOverdue ? 'pointer' : 'default'
                                }}
                                title={td.status}
                              >
                                {td.name}
                                {td.delayReason && <span style={{ marginLeft: '4px', fontStyle: 'italic', opacity: 0.8 }}>(Delay: {td.delayReason})</span>}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        (() => {
                          let fallbackBg = 'transparent';
                          let fallbackAnim = 'none';
                          const statusLower = (sample.status || '').toLowerCase();
                          const fallbackIsVerified = statusLower.includes('verified') || statusLower.includes('approved') || statusLower.includes('dispatch') || statusLower.includes('authorized');
                          const fallbackIsDone = fallbackIsVerified || statusLower.includes('done') || statusLower.includes('completed');

                          if (sample.isVerificationOverdue && !fallbackIsVerified) {
                              fallbackAnim = 'blinkPurple 1.5s infinite ease-in-out';
                              fallbackBg = 'rgba(139, 92, 246, 0.2)';
                          } else if (sample.isResultOverdue && !fallbackIsDone) {
                              fallbackAnim = 'blinkAlert 1.5s infinite ease-in-out';
                              fallbackBg = 'rgba(245, 158, 11, 0.2)';
                          } else if (sample.isOverdueAfterExtraTime && !fallbackIsDone) {
                              fallbackAnim = 'blinkRed 1s infinite ease-in-out';
                          } else if (sample.isOverdue && !fallbackIsDone) {
                              fallbackAnim = 'blinkAlert 1s infinite ease-in-out';
                          }

                          return (
                            <span 
                              onClick={() => {
                                if (sample.isOverdue && (!sample.testDetails || sample.testDetails.length === 0)) {
                                  // If no specific test details, we can't show checkboxes, so we create a dummy one
                                  setExtendModal({ id: sample.id, barcode: sample.barcode, testDetails: [{name: sample.test, status: sample.status}] });
                                  setExtendSelections([sample.test]);
                                  setExtendMins(30);
                                  setExtendReason('');
                                }
                              }}
                              style={{ 
                                animation: fallbackAnim,
                                background: fallbackBg,
                                padding: sample.isOverdue || fallbackBg !== 'transparent' ? '2px 4px' : '0',
                                borderRadius: '3px',
                                fontSize: '9.5px',
                                display: 'inline-block',
                                cursor: sample.isOverdue ? 'pointer' : 'default'
                              }}>
                              {sample.test}
                            </span>
                          );
                        })()
                      )}
                    </td>
                    <td className="text-secondary" style={{ fontSize: '10px' }}>
                      {sample.entryDate !== '--' ? (
                        <>
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{sample.entryTime}</div>
                          <div>{sample.entryDate}</div>
                        </>
                      ) : '--'}
                    </td>
                    <td className="text-secondary" style={{ fontSize: '10px' }}>
                      {sample.receivedDate !== '--' ? (
                        <>
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{sample.receivedTime}</div>
                          <div>{sample.receivedDate}</div>
                        </>
                      ) : '--'}
                    </td>
                    <td className="text-secondary" style={{ fontSize: '10px' }}>
                      {sample.resultDate !== '--' ? (
                        <>
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{sample.resultTime}</div>
                          <div>{sample.resultDate}</div>
                        </>
                      ) : '--'}
                    </td>
                    <td>
                      <span className={`status-badge ${getStatusClass(sample.status)}`}>
                        {sample.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                        <button 
                          onClick={() => toggleSampleMute(sample.id)}
                          disabled={!(sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated') || sample.isOverdue)}
                          style={{ 
                            background: 'transparent', 
                            border: 'none', 
                            color: mutedSamples.has(sample.id) ? 'var(--text-secondary)' : 'var(--warning)', 
                            cursor: (sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated') || sample.isOverdue) ? 'pointer' : 'default', 
                            padding: '2px',
                            opacity: (sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated') || sample.isOverdue) ? 1 : 0.2
                          }}
                          title={mutedSamples.has(sample.id) ? "Unmute Sample" : "Mute Sample"}
                        >
                          {mutedSamples.has(sample.id) ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        </button>
                        <button 
                          onClick={() => setReceiveModal(sample.id)}
                          disabled={!(sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated'))}
                          style={{ 
                            background: 'transparent', 
                            border: 'none', 
                            color: 'var(--success)', 
                            cursor: (sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated')) ? 'pointer' : 'default', 
                            padding: '2px',
                            opacity: (sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated')) ? 1 : 0.2
                          }}
                          title="Mark as Received"
                        >
                          <CheckCircle size={12} />
                        </button>
                        <button 
                          onClick={() => handleEdit(sample.id, sample.barcode)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '2px' }}
                          title="Edit Barcode"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button 
                          onClick={() => handleDelete(sample.id)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '2px' }}
                          title="Delete Sample"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '2px' }}>
                        <button 
                          onClick={() => handleFalseTrigger(sample.id, 'trigger')}
                          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '3px', padding: '1px 4px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' }}
                          title="Trigger Time"
                        >
                          T
                        </button>
                        <button 
                          onClick={() => handleFalseTrigger(sample.id, 'result')}
                          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '3px', padding: '1px 4px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' }}
                          title="Result Time"
                        >
                          R
                        </button>
                        <button 
                          onClick={() => handleFalseTrigger(sample.id, 'verification')}
                          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '3px', padding: '1px 4px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' }}
                          title="Verification Time"
                        >
                          V
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {deleteModal && (
        <div className="modal-overlay" onClick={() => { setDeleteModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Delete Sample</h3>
            <p className="modal-body">Are you sure you want to delete this sample? This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setDeleteModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}>Cancel</button>
              <button className="btn-danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {receiveModal && (
        <div className="modal-overlay" onClick={() => { setReceiveModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Confirm Received</h3>
            <p className="modal-body">Are you sure you want to mark this sample as received?</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setReceiveModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}>No</button>
              <button className="btn-primary" onClick={confirmMarkReceived}>Yes</button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <div className="modal-overlay" onClick={() => { setEditModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Edit Barcode</h3>
            <div className="modal-body">
              <input 
                type="text" 
                value={editInput}
                onChange={e => setEditInput(e.target.value)}
                className="scanner-input"
                style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', boxSizing: 'border-box' }}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setEditModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}>Cancel</button>
              <button className="btn-primary" onClick={confirmEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {extendModal && (
        <div className="modal-overlay" onClick={() => { setExtendModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Extend Time for {extendModal.barcode}</h3>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>Select Tests to Extend:</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', padding: '10px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                  {extendModal.testDetails.map((td, i) => {
                    const ds = (td.status || '').toLowerCase();
                    const isDone = ds.includes('approved') || ds.includes('completed') || ds.includes('verified') || ds.includes('done') || ds.includes('authorized') || ds.includes('dispatch');
                    
                    if (isDone) return null; // Don't allow extending already done tests

                    return (
                      <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={extendSelections.includes(td.name)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setExtendSelections([...extendSelections, td.name]);
                            } else {
                              setExtendSelections(extendSelections.filter(t => t !== td.name));
                            }
                          }}
                        />
                        {td.name} <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>({td.status})</span>
                      </label>
                    );
                  })}
                  {extendModal.testDetails.filter(td => {
                    const ds = (td.status || '').toLowerCase();
                    return !(ds.includes('approved') || ds.includes('completed') || ds.includes('verified') || ds.includes('done') || ds.includes('authorized') || ds.includes('dispatch'));
                  }).length === 0 && (
                    <div style={{ color: 'var(--text-secondary)' }}>All tests are completed.</div>
                  )}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>Extra Time Needed (Minutes):</label>
                <input 
                  type="number" 
                  value={extendMins}
                  onChange={e => setExtendMins(parseInt(e.target.value) || 0)}
                  className="scanner-input"
                  style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', boxSizing: 'border-box' }}
                  min="1"
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>Reason for Delay:</label>
                <input 
                  type="text" 
                  value={extendReason}
                  onChange={e => setExtendReason(e.target.value)}
                  placeholder="e.g. Machine downtime, sample issue..."
                  className="scanner-input"
                  style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button className="btn-secondary" onClick={() => { setExtendModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}>Cancel</button>
              <button className="btn-primary" onClick={confirmExtend} disabled={extendSelections.length === 0 || !extendReason.trim()}>Confirm Extension</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}