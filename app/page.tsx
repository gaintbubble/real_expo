"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { saveBarcodeToDatabase, getAllTrackedSamples, clearAllSamples, deleteSample, updateSampleBarcode, markSampleReceived, extendSampleTime, simulateFalseTrigger, toggleSampleProvisional } from './actions';
import { getDepartments } from './actions/departments';
import { DatePicker } from './components/DatePicker';
import { Edit2, Trash2, Barcode, CheckCircle, Volume2, VolumeX, X as XIcon, ChevronDown, Bell, Search } from 'lucide-react';
import { useSearch } from './context/SearchContext';
import { formatTimeIST, formatDateIST, getTodayDateIST } from './lib/dateUtils';

interface AlarmTriggers {
  collected: boolean;
  triggerOverdue: boolean;
  resultOverdue: boolean;
  verificationOverdue: boolean;
  tatOverdue: boolean;
  extendedOverdue: boolean;
}

const DEFAULT_ALARM_TRIGGERS: AlarmTriggers = {
  collected: true,
  triggerOverdue: true,
  resultOverdue: true,
  verificationOverdue: true,
  tatOverdue: true,
  extendedOverdue: true,
};

const ALARM_TRIGGER_OPTIONS: { id: keyof AlarmTriggers; label: string; color: string }[] = [
  { id: 'collected', label: 'Collected / Batch', color: '#ef4444' },
  { id: 'triggerOverdue', label: 'Trigger Overdue', color: '#f59e0b' },
  { id: 'resultOverdue', label: 'Result Overdue', color: '#f59e0b' },
  { id: 'verificationOverdue', label: 'Verification Overdue', color: '#a855f7' },
  { id: 'tatOverdue', label: 'TAT Overdue', color: '#ef4444' },
  { id: 'extendedOverdue', label: 'Critical Overdue', color: '#dc2626' },
];

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
  rawCreatedAt?: string | null;
  rawReceivedTime?: string | null;
  rawResultTime?: string | null;
  nextCheckTime?: string | null;
  triggerTime?: number | null;
  triggerTarget?: string | null;
  isTriggerPending?: boolean;
  triggerRemainingSecs?: number;
  target: string;
  delayPercent: number;
  departments?: string[];
  isOverdue?: boolean;
  isOverdueAfterExtraTime?: boolean;
  testDetails?: any[];
  isTriggerOverdue?: boolean;
  isResultOverdue?: boolean;
  isVerificationOverdue?: boolean;
  isProvisional?: boolean;
  provisionalTime?: number | null;
  provisionalExpiry?: string | null;
  intervalTime?: number | null;
  intervalTimeVerified?: number | null;
  isCompleted?: boolean;
}

export function getSampleStageInfo(sample: Sample) {
  const s = (sample.status || '').toLowerCase();
  const isPreCheck = s.includes('pending check') || s.includes('scanned') || s.includes('waiting');
  const isReceived = !isPreCheck && (sample.receivedDate !== '--' || 
    s.includes('received') || 
    s.includes('result done') || 
    s.includes('done') || 
    s.includes('completed') || 
    s.includes('verified') || 
    s.includes('approved') || 
    s.includes('authorized') || 
    s.includes('dispatch'));

  let isResultDone = false;
  let isResultVerified = false;
  let isResultApproved = false;

  let hasPendingResultTest = false;
  let hasPendingVerificationTest = false;
  let hasPendingApprovalTest = false;

  if (sample.testDetails && sample.testDetails.length > 0) {
    let allDone = true;
    let allVerified = true;
    let allApproved = true;

    for (const td of sample.testDetails) {
      const ds = (td.status || '').toLowerCase();
      const testApproved = ds.includes('approved') || ds.includes('authorized') || ds.includes('dispatch') || ds.includes('print');
      const testVerified = testApproved || ds.includes('verified');
      const testDone = testVerified || ds.includes('done') || ds.includes('completed') || ds.includes('entered');

      if (!testDone) {
        allDone = false;
        hasPendingResultTest = true;
      }
      if (!testVerified) {
        allVerified = false;
        if (testDone) {
          hasPendingVerificationTest = true;
        }
      }
      if (!testApproved) {
        allApproved = false;
        if (testVerified || testDone) {
          hasPendingApprovalTest = true;
        }
      }
    }

    const fallbackApproved = s.includes('approved') || s.includes('authorized') || s.includes('dispatch') || s.includes('print');
    const fallbackVerified = fallbackApproved || s.includes('verified');
    const fallbackDone = fallbackVerified || s.includes('result done') || s.includes('done') || s.includes('completed') || s.includes('entered');

    isResultApproved = allApproved || fallbackApproved;
    isResultVerified = isResultApproved || allVerified || fallbackVerified;
    isResultDone = isResultVerified || allDone || fallbackDone;
  } else {
    isResultApproved = s.includes('approved') || s.includes('authorized') || s.includes('dispatch') || s.includes('print');
    isResultVerified = isResultApproved || s.includes('verified');
    isResultDone = isResultVerified || s.includes('result done') || s.includes('done') || s.includes('completed') || s.includes('entered');
  }

  // 1. Result Done pending: sample has not finished result entry
  const needsResultDone = !isResultDone;

  // 2. Result Verified pending: results are completed or available for verification, but verification is not yet completed
  const needsResultVerified = !isResultVerified && (isResultDone || hasPendingVerificationTest);

  // 3. Result Approval pending: verified (or done) but not yet approved
  const needsResultApproval = !isResultApproved && (isResultVerified || hasPendingApprovalTest || (isResultDone && !hasPendingResultTest));

  return {
    isReceived,
    isResultDone,
    isResultVerified,
    isResultApproved,
    needsResultDone,
    needsResultVerified,
    needsResultApproval,
  };
}

export interface TriggerCountdownState {
  phase: 'initial_check' | 'result_due' | 'verify_due' | 'completed';
  label: string;
  formattedTime: string;
  isOverdue: boolean;
  bg: string;
  color: string;
  border: string;
}

export function getTriggerCountdownState(sample: Sample, nowMs: number): TriggerCountdownState {
  const sLower = (sample.status || '').toLowerCase();

  // 1. Completed State:
  // Active when test reaches Verified, Approved, Authorized, Dispatch, or isCompleted is true
  const isVerified = Boolean(
    sample.isCompleted ||
    sLower.includes('verified') ||
    sLower.includes('approved') ||
    sLower.includes('authorized') ||
    sLower.includes('dispatch')
  );

  if (isVerified) {
    return {
      phase: 'completed',
      label: 'Completed',
      formattedTime: '',
      isOverdue: false,
      bg: 'rgba(16, 185, 129, 0.12)',
      color: '#10b981',
      border: '1px solid rgba(16, 185, 129, 0.3)'
    };
  }

  // Detect if verification SLA is configured
  let hasVerificationSla = false;
  let verifSlaMins = 0;
  if (sample.intervalTimeVerified != null && sample.intervalTimeVerified > 0) {
    hasVerificationSla = true;
    verifSlaMins = sample.intervalTimeVerified;
  } else if (sample.testDetails && Array.isArray(sample.testDetails)) {
    const validVerifs = sample.testDetails
      .map((t: any) => t.intervalTimeVerified)
      .filter((v: any) => typeof v === 'number' && v > 0);
    if (validVerifs.length > 0) {
      hasVerificationSla = true;
      verifSlaMins = Math.min(...validVerifs);
    }
  }

  // 2. Result Done Phase:
  const isResultDone = sLower.includes('result done') || sLower.includes('done') || sLower.includes('completed');
  if (isResultDone) {
    if (!hasVerificationSla) {
      // Reached Result Done status with NO verification time configured -> Completed!
      return {
        phase: 'completed',
        label: 'Completed',
        formattedTime: '',
        isOverdue: false,
        bg: 'rgba(16, 185, 129, 0.12)',
        color: '#10b981',
        border: '1px solid rgba(16, 185, 129, 0.3)'
      };
    }

    // Phase 3: Verification Countdown
    const resultBaseMs = sample.rawResultTime
      ? new Date(sample.rawResultTime).getTime()
      : (sample.rawReceivedTime ? new Date(sample.rawReceivedTime).getTime() : nowMs);

    const safeResultBaseMs = isNaN(resultBaseMs) ? nowMs : resultBaseMs;
    const targetMs = safeResultBaseMs + (verifSlaMins || 15) * 60000;
    const diffSecs = Math.floor((targetMs - nowMs) / 1000);

    if (diffSecs >= 0) {
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;
      return {
        phase: 'verify_due',
        label: 'Verify Due',
        formattedTime: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
        isOverdue: false,
        bg: 'rgba(168, 85, 247, 0.12)',
        color: '#a855f7',
        border: '1px solid rgba(168, 85, 247, 0.3)'
      };
    } else {
      const overdueSecs = Math.abs(diffSecs);
      const mins = Math.floor(overdueSecs / 60);
      const secs = overdueSecs % 60;
      return {
        phase: 'verify_due',
        label: 'Verify Overdue',
        formattedTime: `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
        isOverdue: true,
        bg: 'rgba(239, 68, 68, 0.14)',
        color: '#ef4444',
        border: '1px solid rgba(239, 68, 68, 0.4)'
      };
    }
  }

  // 3. Phase 1: Initial Check Countdown (Scanned / Pending Check)
  const isPreCheck = sLower.includes('pending check') || sLower.includes('scanned') || sLower.includes('waiting');
  const trigMins = sample.triggerTime ?? (sample.departments?.some(d => d.toLowerCase() === 'haematology') ? 2 : 0);
  const scanMs = sample.rawCreatedAt ? new Date(sample.rawCreatedAt).getTime() : 0;
  const safeScanMs = isNaN(scanMs) ? 0 : scanMs;
  const trigTargetMs = (safeScanMs > 0 && trigMins > 0) ? (safeScanMs + trigMins * 60000) : 0;
  const isTrigActive = trigTargetMs > 0 && nowMs < trigTargetMs;

  if (isPreCheck || isTrigActive) {
    const targetMs = trigTargetMs > 0 ? trigTargetMs : (nowMs + 120000);
    const diffSecs = Math.ceil((targetMs - nowMs) / 1000);

    if (diffSecs > 0) {
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;
      return {
        phase: 'initial_check',
        label: 'Initial Check',
        formattedTime: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
        isOverdue: false,
        bg: 'rgba(59, 130, 246, 0.12)',
        color: 'var(--accent-primary)',
        border: '1px solid rgba(59, 130, 246, 0.3)'
      };
    } else {
      return {
        phase: 'initial_check',
        label: 'Initial Check',
        formattedTime: '00:00',
        isOverdue: false,
        bg: 'rgba(59, 130, 246, 0.15)',
        color: 'var(--accent-primary)',
        border: '1px solid rgba(59, 130, 246, 0.4)'
      };
    }
  }

  // 4. Phase 2: Result Done Countdown (Received status, waiting for results)
  const receivedMs = sample.rawReceivedTime
    ? new Date(sample.rawReceivedTime).getTime()
    : (sample.rawCreatedAt ? new Date(sample.rawCreatedAt).getTime() : nowMs);

  const safeReceivedMs = isNaN(receivedMs) ? nowMs : receivedMs;

  let resultSlaMins = sample.intervalTime || 30;
  let extraMins = 0;
  if (sample.testDetails && Array.isArray(sample.testDetails) && sample.testDetails.length > 0) {
    const validIntervals = sample.testDetails
      .map((t: any) => t.intervalTime)
      .filter((v: any) => typeof v === 'number' && v > 0);
    if (validIntervals.length > 0) resultSlaMins = Math.min(...validIntervals);

    const validExtras = sample.testDetails
      .map((t: any) => t.extraTime)
      .filter((v: any) => typeof v === 'number' && v > 0);
    if (validExtras.length > 0) extraMins = Math.max(0, ...validExtras);
  }

  const targetMs = safeReceivedMs + (resultSlaMins + extraMins) * 60000;
  const diffSecs = Math.floor((targetMs - nowMs) / 1000);

  if (diffSecs >= 0) {
    const mins = Math.floor(diffSecs / 60);
    const secs = diffSecs % 60;
    return {
      phase: 'result_due',
      label: 'Result Due',
      formattedTime: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
      isOverdue: false,
      bg: 'rgba(245, 158, 11, 0.12)',
      color: '#f59e0b',
      border: '1px solid rgba(245, 158, 11, 0.3)'
    };
  } else {
    const overdueSecs = Math.abs(diffSecs);
    const mins = Math.floor(overdueSecs / 60);
    const secs = overdueSecs % 60;
    return {
      phase: 'result_due',
      label: 'Result Overdue',
      formattedTime: `-${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
      isOverdue: true,
      bg: 'rgba(239, 68, 68, 0.14)',
      color: '#ef4444',
      border: '1px solid rgba(239, 68, 68, 0.4)'
    };
  }
}

export default function Dashboard() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const { searchQuery, setSearchQuery, clearSearch, pendingFilter, setPendingFilter, setPendingCounts, pendingDelayMode, setPendingDelayMode } = useSearch();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDateIST());
  const [isScanning, setIsScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<{ barcode: string; delayMins: number } | null>(null);
  const [isMuted, setIsMuted] = useState(false); // Default Alarm ON on login
  const [alarmTriggers, setAlarmTriggers] = useState<AlarmTriggers>(DEFAULT_ALARM_TRIGGERS);

  useEffect(() => {
    const saved = localStorage.getItem('nexus_alarm_triggers');
    if (saved) {
      try {
        setAlarmTriggers({ ...DEFAULT_ALARM_TRIGGERS, ...JSON.parse(saved) });
      } catch (e) {}
    }
  }, []);
  const [isAlarmDropdownOpen, setIsAlarmDropdownOpen] = useState(false);
  const alarmDropdownRef = useRef<HTMLDivElement>(null);

  const toggleAlarmTrigger = (key: keyof AlarmTriggers) => {
    setAlarmTriggers(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('nexus_alarm_triggers', JSON.stringify(next));
      return next;
    });
  };

  const handleSetAllAlarmTriggers = (val: boolean) => {
    const next: AlarmTriggers = {
      collected: val,
      triggerOverdue: val,
      resultOverdue: val,
      verificationOverdue: val,
      tatOverdue: val,
      extendedOverdue: val,
    };
    setAlarmTriggers(next);
    localStorage.setItem('nexus_alarm_triggers', JSON.stringify(next));
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (alarmDropdownRef.current && !alarmDropdownRef.current.contains(e.target as Node)) {
        setIsAlarmDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [deleteModal, setDeleteModal] = useState<string | null>(null);
  const [receiveModal, setReceiveModal] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{ id: string, barcode: string } | null>(null);
  const [editInput, setEditInput] = useState('');
  const [departments, setDepartments] = useState<{id: string, name: string, triggerTime?: number | null, provisionalTime?: number | null}[]>([]);
  const [activeTab, setActiveTab] = useState<string>('HAEMATOLOGY');
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
    setSelectedDate(getTodayDateIST());
    
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

  const loadRealData = useCallback(async () => {
    try {
      const dbSamples = await getAllTrackedSamples(selectedDate);
      if (!Array.isArray(dbSamples)) return;
      
      const formattedSamples: Sample[] = dbSamples.map((s: any) => {
        const now = new Date();

        const createdAtDate = s.createdAt ? new Date(s.createdAt) : null;
        // Result Entry SLA must start ONLY from actual sample_received_timestamp, not scan time
        const receivedDateObj = s.receivedTime ? new Date(s.receivedTime) : null;
        const resultDateObj = s.resultTime ? new Date(s.resultTime) : null;
        const triggerDelayMins = s.triggerTime || 0;

        const triggerTarget = (createdAtDate && triggerDelayMins > 0)
          ? new Date(createdAtDate.getTime() + triggerDelayMins * 60000)
          : null;
        const isTriggerPending = triggerTarget ? (now < triggerTarget) : false;
        const triggerRemainingSecs = (triggerTarget && isTriggerPending)
          ? Math.max(0, Math.ceil((triggerTarget.getTime() - now.getTime()) / 1000))
          : 0;

        const statusLower = (s.currentStatus || '').toLowerCase();
        const isPreCheck = statusLower.includes('pending check') || statusLower.includes('scanned') || statusLower.includes('waiting');

        // Parse and evaluate individual test SLAs dynamically against persistent timestamps
        const rawTestDetails = s.testDetails ? (() => { try { return JSON.parse(s.testDetails); } catch { return []; } })() : [];

        const testDetails = rawTestDetails.map((td: any) => {
          const ds = (td.status || '').toLowerCase();
          const isApproved = ds.includes('approved') || ds.includes('authorized') || ds.includes('dispatch');
          const isVerified = isApproved || ds.includes('verified');
          const isDone = isVerified || ds.includes('done') || ds.includes('completed');

          // 1. Result Entry SLA Tracking:
          // Starts ONLY from actual sample_received_timestamp when status transitions to RECEIVED.
          // NEVER starts prematurely during Pending Check / Scanned pre-check window.
          let isResultOverdue = false;
          let isResultOverdueAfterExtraTime = false;
          if (receivedDateObj && !isPreCheck && !isDone) {
            const resultEntryMins = td.intervalTime != null ? td.intervalTime : (s.intervalTime || 30);
            const extraMins = td.extraTime || 0;
            const originalDeadline = new Date(receivedDateObj.getTime() + resultEntryMins * 60000);
            const extendedDeadline = new Date(receivedDateObj.getTime() + (resultEntryMins + extraMins) * 60000);
            
            if (now > extendedDeadline) {
              if (extraMins > 0) {
                isResultOverdueAfterExtraTime = true;
              } else {
                isResultOverdue = true;
              }
            } else if (now > originalDeadline && extraMins === 0) {
              isResultOverdue = true;
            }
          }

          // 2. Verification SLA Tracking:
          // Calculate verification deadline using result done timestamp + configured verification time
          // Optional SLA rule: If no verification time is configured for a test, stop all tracking once result is done.
          let isVerificationOverdue = false;
          if (td.intervalTimeVerified != null && td.intervalTimeVerified > 0) {
            if (isDone && !isVerified) {
              const baseTime = resultDateObj || receivedDateObj;
              if (baseTime) {
                const verificationDeadline = new Date(baseTime.getTime() + td.intervalTimeVerified * 60000);
                if (now > verificationDeadline) {
                  isVerificationOverdue = true;
                }
              }
            }
          }

          return {
            ...td,
            isResultOverdue,
            isResultOverdueAfterExtraTime,
            isVerificationOverdue,
            isDone,
            isVerified,
            isApproved
          };
        });

        // Fallback if sample has no testDetails array:
        const fallbackIsVerified = statusLower.includes('verified') || statusLower.includes('approved') || statusLower.includes('dispatch');
        const fallbackIsDone = fallbackIsVerified || statusLower.includes('done') || statusLower.includes('completed');

        let fallbackResultOverdue = false;
        if (testDetails.length === 0 && receivedDateObj && !isPreCheck && !fallbackIsDone) {
          const limit = new Date(receivedDateObj.getTime() + (s.intervalTime || 30) * 60000);
          if (now > limit) fallbackResultOverdue = true;
        }

        let fallbackVerificationOverdue = false;
        if (testDetails.length === 0 && s.intervalTimeVerified != null && s.intervalTimeVerified > 0 && fallbackIsDone && !fallbackIsVerified) {
          const baseTime = resultDateObj || receivedDateObj;
          if (baseTime) {
            const limit = new Date(baseTime.getTime() + s.intervalTimeVerified * 60000);
            if (now > limit) fallbackVerificationOverdue = true;
          }
        }

        const isResultOverdue = testDetails.some((t: any) => t.isResultOverdue) || fallbackResultOverdue;
        const isVerificationOverdue = testDetails.some((t: any) => t.isVerificationOverdue) || fallbackVerificationOverdue;

        return {
          id: s.id,
          barcode: s.barcode,
          patient: s.patientName || '--',
          test: s.displayTestName || s.testName || 'Waiting...',
          testDetails,
          serviceCd: s.serviceCd || '--',
          status: s.currentStatus,
          entryDate: formatDateIST(s.createdAt),
          entryTime: formatTimeIST(s.createdAt),
          receivedDate: s.receivedTime ? formatDateIST(s.receivedTime) : '--',
          receivedTime: s.receivedTime ? formatTimeIST(s.receivedTime) : '--',
          resultDate: formatDateIST(s.resultTime),
          resultTime: formatTimeIST(s.resultTime),
          rawCreatedAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
          rawReceivedTime: s.receivedTime ? new Date(s.receivedTime).toISOString() : null,
          rawResultTime: s.resultTime ? new Date(s.resultTime).toISOString() : null,
          nextCheckTime: s.nextCheckTime,
          triggerTime: triggerDelayMins,
          triggerTarget: triggerTarget ? triggerTarget.toISOString() : null,
          isTriggerPending,
          triggerRemainingSecs,
          intervalTime: s.intervalTime ?? (testDetails.length > 0 ? Math.min(...testDetails.map((t: any) => t.intervalTime || 30)) : 30),
          intervalTimeVerified: s.intervalTimeVerified !== undefined ? s.intervalTimeVerified : (testDetails.length > 0 && testDetails.some((t: any) => t.intervalTimeVerified != null) ? Math.min(...testDetails.filter((t: any) => t.intervalTimeVerified != null).map((t: any) => t.intervalTimeVerified)) : null),
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
          ) && (testDetails.length > 0 ? testDetails.some((t: any) => t.extraTime && t.extraTime > 0) : false),
          isTriggerOverdue: false,
          isResultOverdue,
          isVerificationOverdue,
          isProvisional: Boolean(s.isProvisional),
          provisionalTime: s.provisionalTime,
          provisionalExpiry: s.provisionalExpiry,
          isCompleted: Boolean(s.isCompleted),
        };
      });
      setSamples(formattedSamples);
    } catch (error) {
      console.warn("Polling error (Server might be restarting):", error);
    }
  }, [selectedDate]);

  // 1-second live ticker to keep countdowns and timers updating live on screen
  const [, setLiveTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLiveTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Initial load
    loadRealData();
    
    // Poll every 5 seconds to automatically show updates from the extension
    const intervalId = setInterval(loadRealData, 5000);
    
    if (inputRef.current) {
      inputRef.current.focus();
    }
    
    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [loadRealData]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentInput = barcodeInput.trim();
    if (!currentInput) return;
    
    // Clear input immediately for next scan instantly
    setBarcodeInput('');
    setIsScanning(true);
    
    // Focus back immediately
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 10);
    
    const now = new Date();
    const effectiveDept = (activeTab && activeTab.trim()) ? activeTab.trim() : "HAEMATOLOGY";
    const currentDept = departments.find(d => d.name.toLowerCase() === effectiveDept.toLowerCase());
    let delayMins = currentDept?.triggerTime ?? (effectiveDept.toLowerCase() === 'haematology' ? 2 : 0);
    if (delayMins <= 0 && effectiveDept.toLowerCase() === 'haematology') {
      delayMins = 2;
    }

    const defaultTestName = "Resolving...";
    const defaultTestDetails = [{
      name: defaultTestName,
      status: "Pending Check",
      intervalTime: 10,
      intervalTimeVerified: 15,
      department: effectiveDept
    }];

    // Step 1: Immediate row creation on dashboard in Pending Check status
    const optimisticSample: Sample = {
      id: `temp-${Date.now()}`,
      barcode: currentInput,
      patient: "--",
      test: defaultTestName,
      serviceCd: `DEPT:${effectiveDept}`,
      status: "Pending Check",
      entryDate: formatDateIST(now),
      entryTime: formatTimeIST(now),
      receivedDate: '--',
      receivedTime: '--',
      resultDate: '--',
      resultTime: '--',
      rawCreatedAt: now.toISOString(),
      rawReceivedTime: null,
      rawResultTime: null,
      triggerTime: delayMins,
      triggerTarget: delayMins > 0 ? new Date(now.getTime() + delayMins * 60000).toISOString() : null,
      isTriggerPending: delayMins > 0,
      triggerRemainingSecs: delayMins * 60,
      intervalTime: 10,
      intervalTimeVerified: 15,
      target: '--',
      delayPercent: 0,
      departments: [effectiveDept],
      isOverdue: false,
      isOverdueAfterExtraTime: false,
      testDetails: defaultTestDetails,
      isTriggerOverdue: false,
      isResultOverdue: false,
      isVerificationOverdue: false,
      isProvisional: false,
      isCompleted: false,
    };

    setSamples(prev => [optimisticSample, ...prev.filter(s => s.barcode !== currentInput)]);

    try {
      const res = await fetch('/api/save-barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: currentInput, activeTab: effectiveDept })
      });
      const response = await res.json();
      
      if (response.success) {
        const triggerDelay = response.triggerDelayMins ?? delayMins;
        setScanNotice({ barcode: currentInput, delayMins: triggerDelay });
        setTimeout(() => setScanNotice(null), 5000);
        await loadRealData();
      } else {
        alert(response.message || "Failed to save barcode.");
        await loadRealData();
      }
    } catch (error) {
      console.error("Scan error:", error);
      alert("Error saving barcode.");
      await loadRealData();
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
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
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
      if (!hasDeptAccess || mutedSamples.has(s.id) || s.isProvisional) return false;

      const sLower = s.status.toLowerCase();
      const isCollected = sLower.includes('collected') || sLower.includes('batch generated');

      return (
        (alarmTriggers.collected && isCollected) ||
        (alarmTriggers.triggerOverdue && !!s.isTriggerOverdue) ||
        (alarmTriggers.resultOverdue && !!s.isResultOverdue) ||
        (alarmTriggers.verificationOverdue && !!s.isVerificationOverdue) ||
        (alarmTriggers.tatOverdue && !!s.isOverdue) ||
        (alarmTriggers.extendedOverdue && !!s.isOverdueAfterExtraTime)
      );
    });

    if (hasAlarmSamples && !isMuted) {
      const interval = setInterval(playAlarm, 3000);
      return () => clearInterval(interval);
    }
  }, [samples, isMuted, mutedSamples, alarmTriggers, user, departments]);

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
        receivedDate: formatDateIST(res.sample.receivedTime),
        receivedTime: formatTimeIST(res.sample.receivedTime)
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
            receivedDate: res.sample.receivedTime ? formatDateIST(res.sample.receivedTime) : s.receivedDate,
            receivedTime: res.sample.receivedTime ? formatTimeIST(res.sample.receivedTime) : s.receivedTime,
            resultDate: res.sample.resultTime ? formatDateIST(res.sample.resultTime) : s.resultDate,
            resultTime: res.sample.resultTime ? formatTimeIST(res.sample.resultTime) : s.resultTime,
            testDetails: type === 'verification' ? testDetails : s.testDetails
          };
        }
        return s;
      }));
    } else {
      alert(res.message || "Failed to trigger.");
    }
  };

  const [togglingProvisional, setTogglingProvisional] = useState<string | null>(null);

  const handleToggleProvisional = async (id: string) => {
    try {
      setTogglingProvisional(id);
      const res = await toggleSampleProvisional(id);
      if (res.success && res.sample) {
        setSamples(prev => prev.map(s => s.id === id ? { 
          ...s, 
          isProvisional: res.isProvisional,
          provisionalExpiry: res.provisionalExpiry 
        } : s));
      } else {
        alert(res.message || "Failed to toggle provisional status.");
      }
    } catch (err) {
      console.error("Toggle provisional error:", err);
    } finally {
      setTogglingProvisional(null);
    }
  };

  const getStatusClass = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('scanned') || s.includes('pending check') || s.includes('waiting')) return 'pending-check';
    if (s.includes('received')) return 'received';
    if (s.includes('pending')) return 'pending';
    if (s.includes('completed') || s.includes('done') || s.includes('verified') || s.includes('approved')) return 'completed';
    if (s.includes('collected') || s.includes('batch generated')) return 'collected';
    return 'default';
  };

  const getCardStatusClass = (sample: Sample) => {
    if (sample.isProvisional) return 'status-provisional';
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

  const sampleMatchesDate = useCallback((sample: Sample) => {
    if (!selectedDate) return true;
    const [year, month, day] = selectedDate.split('-').map(Number);
    const startObj = new Date(year, month - 1, day);
    startObj.setHours(0, 0, 0, 0);
    const endObj = new Date(year, month - 1, day);
    endObj.setHours(23, 59, 59, 999);

    const checkMatch = (dateStr: string) => {
      if (!dateStr || dateStr === '--') return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      d.setHours(12, 0, 0, 0);
      return d >= startObj && d <= endObj;
    };

    return checkMatch(sample.receivedDate) || checkMatch(sample.resultDate) || checkMatch(sample.entryDate);
  }, [selectedDate]);

  // Samples belonging to departments the logged-in user has access to
  const userAccessibleSamples = useMemo(() => {
    return samples.filter(sample => {
      if (user?.username === 'admin') return true;
      return sample.departments && sample.departments.some(dName => departments.some(dept => dept.name === dName));
    });
  }, [samples, user, departments]);

  // Base samples for the selected department tab matching date
  const selectedDeptSamples = useMemo(() => {
    return userAccessibleSamples.filter(sample => {
      const matchesDept = activeTab ? (sample.departments && sample.departments.includes(activeTab)) : true;
      return matchesDept && sampleMatchesDate(sample);
    });
  }, [userAccessibleSamples, activeTab, sampleMatchesDate]);

  // Update pending counts for header status bars whenever current department samples change
  useEffect(() => {
    let resultDonePending = 0;
    let resultDoneTotal = selectedDeptSamples.length;

    let resultVerifiedPending = 0;
    let resultVerifiedTotal = selectedDeptSamples.length;

    let resultApprovalPending = 0;
    let approvalEligibleCount = 0;

    selectedDeptSamples.forEach(sample => {
      const stage = getSampleStageInfo(sample);
      if (stage.needsResultDone) {
        resultDonePending++;
      }
      if (stage.needsResultVerified) {
        resultVerifiedPending++;
      }
      if (stage.needsResultApproval) {
        resultApprovalPending++;
      }
      if (stage.isResultVerified || stage.needsResultApproval || stage.isResultApproved) {
        approvalEligibleCount++;
      }
    });

    const resultApprovalTotal = approvalEligibleCount > 0 ? approvalEligibleCount : (selectedDeptSamples.length || 0);

    setPendingCounts({
      resultDonePending,
      resultDoneTotal,
      resultVerifiedPending,
      resultVerifiedTotal,
      resultApprovalPending,
      resultApprovalTotal,
    });
  }, [selectedDeptSamples, setPendingCounts]);

  // Count for each department tab for current date
  const getDeptSampleCount = (deptName: string) => {
    return userAccessibleSamples.filter(s => 
      s.departments && s.departments.includes(deptName) && sampleMatchesDate(s)
    ).length;
  };

  const filteredSamples = userAccessibleSamples.filter(sample => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      sample.barcode.toLowerCase().includes(query) ||
      sample.patient.toLowerCase().includes(query) ||
      sample.test.toLowerCase().includes(query) ||
      sample.status.toLowerCase().includes(query)
    );
    
    let matchesDate = sampleMatchesDate(sample);

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
      const isPreCheck = s.includes('pending check') || s.includes('scanned') || s.includes('waiting');
      const isReceived = !isPreCheck && (sample.receivedDate !== '--' || s.includes('received') || s.includes('result done') || s.includes('verified'));

      if (statusFilter === 'not_received') {
        matchesStatusFilter = !isReceived;
      } else if (statusFilter === 'result_not_done') {
        matchesStatusFilter = !!sample.isResultOverdue;
      } else if (statusFilter === 'not_verified') {
        matchesStatusFilter = !!sample.isVerificationOverdue;
      } else if (statusFilter === 'provisional') {
        matchesStatusFilter = !!sample.isProvisional;
      }
    }

    let matchesPendingFilter = true;
    if (pendingFilter !== 'all') {
      const stage = getSampleStageInfo(sample);
      if (pendingFilter === 'result_done') {
        matchesPendingFilter = stage.needsResultDone;
      } else if (pendingFilter === 'result_verified') {
        matchesPendingFilter = stage.needsResultVerified;
      } else if (pendingFilter === 'result_approval') {
        matchesPendingFilter = stage.needsResultApproval;
      }
    }

    return matchesSearch && matchesDate && matchesDepartment && matchesStatusFilter && matchesPendingFilter;
  });

  return (
    <div className="dashboard-container">
      <main>
        <section className="samples-section">
          <div className="section-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
            <div className="tabs-container" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '6px', width: '100%', borderBottom: '1px solid var(--border-color)' }}>
              {departments.map(dept => {
                const count = getDeptSampleCount(dept.name);
                return (
                  <button 
                    key={dept.id}
                    onClick={() => setActiveTab(dept.name)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: 'none',
                      background: activeTab === dept.name ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                      color: activeTab === dept.name ? 'white' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.73rem',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    <span>{dept.name}</span>
                    <span style={{
                      fontSize: '0.65rem',
                      padding: '0px 5px',
                      borderRadius: '10px',
                      background: activeTab === dept.name ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                      color: activeTab === dept.name ? '#ffffff' : 'var(--text-secondary)',
                      fontWeight: 600
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
              {departments.length > 1 && (
                <button
                  onClick={handleSetDefaultDept}
                  style={{
                    marginLeft: 'auto',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.72rem',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Make this my default tab"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                  Set as Default
                </button>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="header-search" style={{ width: '235px', padding: '0.2rem 0.5rem', margin: 0, height: '26px', display: 'flex', alignItems: 'center', position: 'relative' }}>
                  <Search size={13} className="search-icon" style={{ color: 'var(--text-secondary)', marginRight: '6px', flexShrink: 0 }} />
                  <input 
                    type="text" 
                    placeholder="Search samples, patients, barcodes..." 
                    className="search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ fontSize: '0.72rem', width: '100%' }}
                  />
                  {searchQuery && (
                    <button 
                      onClick={clearSearch} 
                      type="button"
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '1px', marginLeft: '2px' }}
                      title="Clear search"
                    >
                      <XIcon size={12} />
                    </button>
                  )}
                </div>

                {pendingFilter !== 'all' && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    background: pendingFilter === 'result_done' ? 'rgba(245, 158, 11, 0.15)' : pendingFilter === 'result_verified' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(6, 182, 212, 0.15)',
                    color: pendingFilter === 'result_done' ? '#f59e0b' : pendingFilter === 'result_verified' ? '#a855f7' : '#06b6d4',
                    border: `1px solid ${pendingFilter === 'result_done' ? 'rgba(245, 158, 11, 0.4)' : pendingFilter === 'result_verified' ? 'rgba(168, 85, 247, 0.4)' : 'rgba(6, 182, 212, 0.4)'}`,
                    whiteSpace: 'nowrap'
                  }}>
                    <span>
                      Pending: {pendingFilter === 'result_done' ? 'Result Done' : pendingFilter === 'result_verified' ? 'Result Verified' : 'Result Approval'}
                    </span>
                    <button 
                      onClick={() => setPendingFilter('all')} 
                      type="button"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        padding: 0
                      }}
                      title="Clear pending filter"
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <form onSubmit={handleScan} className="header-search" style={{ position: 'relative', width: '145px', padding: '0.2rem 0.45rem', margin: 0, height: '26px', borderColor: 'var(--accent-primary)', background: 'rgba(59, 130, 246, 0.05)' }}>
                  <Barcode size={13} className="search-icon" style={{ color: 'var(--accent-primary)', marginRight: '5px' }} />
                  <input 
                    ref={inputRef}
                    type="text"
                    placeholder="Scan..."
                    className="search-input"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    style={{ fontSize: '0.72rem' }}
                  />
                  {scanNotice && (
                    <div style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      zIndex: 100,
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--accent-primary)',
                      borderRadius: '5px',
                      padding: '4px 8px',
                      whiteSpace: 'nowrap',
                      fontSize: '0.7rem',
                      color: 'var(--text-primary)',
                      boxShadow: '0 4px 15px rgba(0,0,0,0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      animation: 'fadeIn 0.15s ease'
                    }}>
                      <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{scanNotice.barcode}</span>
                      {scanNotice.delayMins > 0 ? (
                        <span style={{ color: 'var(--warning)', fontSize: '0.66rem' }}>
                          ({scanNotice.delayMins}m trigger delay)
                        </span>
                      ) : (
                        <span style={{ color: 'var(--success)', fontSize: '0.66rem' }}>(Instant)</span>
                      )}
                    </div>
                  )}
                </form>

                <DatePicker 
                  value={selectedDate}
                  onChange={setSelectedDate} 
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    padding: '0.2rem 0.45rem',
                    height: '26px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.72rem',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="not_received">Not Received</option>
                  <option value="result_not_done">Result Not Done</option>
                  <option value="not_verified">Not Verified</option>
                  <option value="provisional">Provisional</option>
                </select>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.73rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{filteredSamples.length} {filteredSamples.length !== selectedDeptSamples.length ? `(${selectedDeptSamples.length})` : ''}</span>
                  {/* Alarm Control with Customizable Dropdown */}
                  <div ref={alarmDropdownRef} style={{ position: 'relative', display: 'inline-flex' }}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'stretch', 
                      borderRadius: '4px', 
                      overflow: 'hidden', 
                      border: `1px solid ${isMuted ? 'var(--border-color)' : '#10b981'}`, 
                      background: isMuted ? 'transparent' : 'rgba(16, 185, 129, 0.08)' 
                    }}>
                      <button 
                        onClick={() => setIsMuted(!isMuted)}
                        style={{ 
                          background: 'transparent', 
                          border: 'none', 
                          color: isMuted ? 'var(--text-secondary)' : '#10b981', 
                          padding: '2px 8px', 
                          cursor: 'pointer', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '5px',
                          fontSize: '0.75rem',
                          fontWeight: 600
                        }}
                        title={isMuted ? "Alarm is currently muted. Click to turn Alarm ON." : "Alarm is currently active. Click to mute."}
                      >
                        {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                        <span>{isMuted ? "Alarm OFF" : "Alarm ON"}</span>
                      </button>
                      
                      <button
                        onClick={() => setIsAlarmDropdownOpen(!isAlarmDropdownOpen)}
                        style={{
                          background: isMuted ? 'rgba(255, 255, 255, 0.04)' : 'rgba(16, 185, 129, 0.18)',
                          border: 'none',
                          borderLeft: `1px solid ${isMuted ? 'var(--border-color)' : 'rgba(16, 185, 129, 0.3)'}`,
                          color: isMuted ? 'var(--text-secondary)' : '#10b981',
                          padding: '0 5px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Configure Alarm triggers & options (Dropdown)"
                      >
                        <ChevronDown size={12} style={{ transform: isAlarmDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} />
                      </button>
                    </div>

                    {/* Alarm Triggers Dropdown Menu (Cute & Compact) */}
                    {isAlarmDropdownOpen && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        width: '220px',
                        background: 'var(--bg-secondary)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '12px',
                        boxShadow: '0 10px 25px -3px rgba(0, 0, 0, 0.45)',
                        zIndex: 100,
                        padding: '10px',
                        animation: 'scaleIn 0.15s ease-out'
                      }}>
                        {/* Cute Mini Header */}
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          paddingBottom: '6px', 
                          borderBottom: '1px solid var(--border-color)', 
                          marginBottom: '6px' 
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            <Bell size={13} style={{ color: 'var(--accent-primary)' }} />
                            <span>Alarm Alerts</span>
                          </div>
                          <span style={{
                            fontSize: '0.68rem',
                            padding: '1px 6px',
                            borderRadius: '10px',
                            background: isMuted ? 'rgba(255, 255, 255, 0.06)' : 'rgba(16, 185, 129, 0.15)',
                            color: isMuted ? 'var(--text-secondary)' : '#10b981',
                            fontWeight: 600
                          }}>
                            {isMuted ? "Muted" : `${Object.values(alarmTriggers).filter(Boolean).length}/6 on`}
                          </span>
                        </div>

                        {/* Trigger Checkboxes (Compact & Cute) */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {ALARM_TRIGGER_OPTIONS.map(opt => {
                            const isChecked = alarmTriggers[opt.id];
                            return (
                              <label
                                key={opt.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '5px 7px',
                                  borderRadius: '6px',
                                  background: isChecked ? 'rgba(59, 130, 246, 0.06)' : 'transparent',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                  userSelect: 'none'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                                  <span style={{ fontSize: '0.74rem', fontWeight: 500, color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                    {opt.label}
                                  </span>
                                </div>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleAlarmTrigger(opt.id)}
                                  style={{
                                    cursor: 'pointer',
                                    accentColor: 'var(--accent-primary)',
                                    margin: 0,
                                    width: '13px',
                                    height: '13px'
                                  }}
                                />
                              </label>
                            );
                          })}
                        </div>

                        {/* Cute Mini Footer */}
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          paddingTop: '8px', 
                          marginTop: '6px', 
                          borderTop: '1px solid var(--border-color)',
                          fontSize: '0.7rem' 
                        }}>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              onClick={() => handleSetAllAlarmTriggers(true)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: 0, fontWeight: 500, fontSize: '0.7rem' }}
                            >
                              All
                            </button>
                            <span style={{ color: 'var(--border-color)', fontSize: '0.65rem' }}>•</span>
                            <button
                              onClick={() => handleSetAllAlarmTriggers(false)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, fontSize: '0.7rem' }}
                            >
                              None
                            </button>
                          </div>

                          <button
                            onClick={playAlarm}
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-tertiary)',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontWeight: 500,
                              transition: 'all 0.15s ease'
                            }}
                            title="Play test beep"
                          >
                            <Volume2 size={11} />
                            <span>Test</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
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
            <table className="samples-table" style={{ fontSize: '10px' }}>
              <thead>
                <tr>
                  <th style={{ width: '36px', textAlign: 'center' }}>#</th>
                  <th style={{ width: '85px' }}>Barcode</th>
                  <th style={{ width: '13%' }}>Patient</th>
                  <th style={{ minWidth: '150px' }}>Test</th>
                  <th style={{ width: '70px' }}>Entry Date</th>
                  <th style={{ width: '70px' }}>Received</th>
                  <th style={{ width: '70px' }}>Result Time</th>
                  <th style={{ width: '90px' }}>Status</th>
                  <th style={{ width: '95px', textAlign: 'center' }}>Actions</th>
                  <th style={{ width: '94px', textAlign: 'center' }}>Trigger</th>
                </tr>
              </thead>
              <tbody>
                {filteredSamples.map((sample, index) => (
                  <tr key={sample.id} className={`table-row ${getCardStatusClass(sample)}`}>
                    <td className="text-secondary" style={{ textAlign: 'center', fontSize: '9.5px' }}>
                      {filteredSamples.length - index}
                    </td>
                    <td>
                      <span className="barcode-badge">{sample.barcode}</span>
                    </td>
                    <td className="info-value" style={{ fontSize: '10px' }}>{sample.patient}</td>
                    <td className="info-value" style={{ whiteSpace: 'normal' }}>
                      {sample.testDetails && sample.testDetails.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                          {sample.testDetails.map((td: any, i: number) => {
                            const ds = (td.status || '').toLowerCase();
                            const isVerified = td.isVerified || ds.includes('verified') || ds.includes('approved') || ds.includes('dispatch') || ds.includes('authorized');
                            const isDone = td.isDone || isVerified || ds.includes('completed') || ds.includes('done');
                            
                            // Individual test-level SLA alerts
                            const isVerificationOverdue = Boolean(td.isVerificationOverdue && !isVerified);
                            const isExtraOverdue = Boolean(td.isResultOverdueAfterExtraTime && !isDone);
                            const isResultOverdue = Boolean(td.isResultOverdue && !isDone);

                            let bg = 'rgba(255, 255, 255, 0.05)';
                            let anim = 'none';
                            let border = '1px solid var(--border-color)';
                            let color = 'var(--text-primary)';

                            if (isVerificationOverdue) {
                              anim = 'blinkPurple 1.5s infinite ease-in-out';
                              bg = 'rgba(139, 92, 246, 0.22)';
                              border = '1px solid rgba(139, 92, 246, 0.6)';
                              color = '#a78bfa';
                            } else if (isExtraOverdue) {
                              anim = 'blinkRed 1s infinite ease-in-out';
                              bg = 'rgba(239, 68, 68, 0.22)';
                              border = '1px solid rgba(239, 68, 68, 0.6)';
                              color = '#ef4444';
                            } else if (isResultOverdue) {
                              anim = 'blinkAlert 1.5s infinite ease-in-out';
                              bg = 'rgba(245, 158, 11, 0.22)';
                              border = '1px solid rgba(245, 158, 11, 0.6)';
                              color = '#f59e0b';
                            } else if (isDone) {
                              // Reached Result Done within allowed time (and verification not overdue or not required)
                              anim = 'none';
                              bg = 'rgba(16, 185, 129, 0.12)';
                              border = '1px solid rgba(16, 185, 129, 0.28)';
                              color = 'var(--success)';
                            }

                            const canExtend = isResultOverdue || isExtraOverdue || isVerificationOverdue;

                            const isResolving = td.name === 'Resolving...' || td.name === 'Fetching Test...';
                            if (isResolving) {
                              return (
                                <span 
                                  key={i}
                                  style={{
                                    fontStyle: 'italic',
                                    color: 'var(--text-secondary)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    fontSize: '9px',
                                    opacity: 0.85
                                  }}
                                  title="Test details will be retrieved upon trigger check"
                                >
                                  <span>⏳</span>
                                  <span>Resolving...</span>
                                </span>
                              );
                            }

                            return (
                              <span 
                                key={i} 
                                onClick={() => {
                                  if (canExtend) handleExtendClick(sample);
                                }}
                                style={{ 
                                  background: bg,
                                  color,
                                  padding: '1px 4px', 
                                  borderRadius: '3px', 
                                  fontSize: '9px',
                                  lineHeight: '1.2',
                                  border,
                                  animation: anim,
                                  cursor: canExtend ? 'pointer' : 'default',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px'
                                }}
                                title={`${td.name} [${td.status || 'Received'}]${td.intervalTime ? ` | Result SLA: ${td.intervalTime}m` : ''}${td.intervalTimeVerified ? ` | Verif SLA: ${td.intervalTimeVerified}m` : ' | No Verif SLA'}`}
                              >
                                <span>{td.name}</span>
                                {td.delayReason && <span style={{ marginLeft: '2px', fontStyle: 'italic', opacity: 0.8 }}>(Delay: {td.delayReason})</span>}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        (() => {
                          const statusLower = (sample.status || '').toLowerCase();
                          const fallbackIsVerified = statusLower.includes('verified') || statusLower.includes('approved') || statusLower.includes('dispatch') || statusLower.includes('authorized');
                          const fallbackIsDone = fallbackIsVerified || statusLower.includes('done') || statusLower.includes('completed');

                          let fallbackBg = 'transparent';
                          let fallbackAnim = 'none';
                          let fallbackBorder = 'none';
                          let fallbackColor = 'var(--text-primary)';

                          if (sample.isVerificationOverdue && !fallbackIsVerified) {
                            fallbackAnim = 'blinkPurple 1.5s infinite ease-in-out';
                            fallbackBg = 'rgba(139, 92, 246, 0.22)';
                            fallbackBorder = '1px solid rgba(139, 92, 246, 0.6)';
                            fallbackColor = '#a78bfa';
                          } else if (sample.isOverdueAfterExtraTime && !fallbackIsDone) {
                            fallbackAnim = 'blinkRed 1s infinite ease-in-out';
                            fallbackBg = 'rgba(239, 68, 68, 0.22)';
                            fallbackBorder = '1px solid rgba(239, 68, 68, 0.6)';
                            fallbackColor = '#ef4444';
                          } else if (sample.isResultOverdue && !fallbackIsDone) {
                            fallbackAnim = 'blinkAlert 1.5s infinite ease-in-out';
                            fallbackBg = 'rgba(245, 158, 11, 0.22)';
                            fallbackBorder = '1px solid rgba(245, 158, 11, 0.6)';
                            fallbackColor = '#f59e0b';
                          } else if (fallbackIsDone) {
                            fallbackBg = 'rgba(16, 185, 129, 0.12)';
                            fallbackBorder = '1px solid rgba(16, 185, 129, 0.28)';
                            fallbackColor = 'var(--success)';
                          }

                          const canExtend = sample.isResultOverdue || sample.isVerificationOverdue || sample.isOverdue;

                          return (
                            <span 
                              onClick={() => {
                                if (canExtend && (!sample.testDetails || sample.testDetails.length === 0)) {
                                  setExtendModal({ id: sample.id, barcode: sample.barcode, testDetails: [{name: sample.test, status: sample.status}] });
                                  setExtendSelections([sample.test]);
                                  setExtendMins(30);
                                  setExtendReason('');
                                }
                              }}
                              style={{ 
                                animation: fallbackAnim,
                                background: fallbackBg,
                                border: fallbackBorder,
                                color: fallbackColor,
                                padding: fallbackBg !== 'transparent' ? '1px 4px' : '0',
                                borderRadius: '3px',
                                fontSize: '9px',
                                lineHeight: '1.2',
                                display: 'inline-block',
                                cursor: canExtend ? 'pointer' : 'default'
                              }}>
                              {sample.test === 'Resolving...' ? (
                                <span style={{ fontStyle: 'italic', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '3px', opacity: 0.85 }}>
                                  <span>⏳</span>
                                  <span>Resolving...</span>
                                </span>
                              ) : (
                                sample.test
                              )}
                            </span>
                          );
                        })()
                      )}
                    </td>
                    <td className="text-secondary" style={{ fontSize: '9px', lineHeight: '1.05' }}>
                      {sample.entryDate !== '--' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.05' }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '9.5px' }}>{sample.entryTime}</span>
                          <span style={{ fontSize: '8.5px', opacity: 0.8 }}>{sample.entryDate}</span>
                        </div>
                      ) : '--'}
                    </td>
                    <td className="text-secondary" style={{ fontSize: '9px', lineHeight: '1.05' }}>
                      {sample.receivedDate !== '--' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.05' }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '9.5px' }}>{sample.receivedTime}</span>
                          <span style={{ fontSize: '8.5px', opacity: 0.8 }}>{sample.receivedDate}</span>
                        </div>
                      ) : '--'}
                    </td>
                    <td className="text-secondary" style={{ fontSize: '9px', lineHeight: '1.05' }}>
                      {sample.resultDate !== '--' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.05' }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '9.5px' }}>{sample.resultTime}</span>
                          <span style={{ fontSize: '8.5px', opacity: 0.8 }}>{sample.resultDate}</span>
                        </div>
                      ) : '--'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                        <span className={`status-badge ${getStatusClass(sample.status)}`}>
                          {sample.status}
                        </span>
                        {sample.isProvisional && (
                          <span 
                            style={{ 
                              fontSize: '7.5px', 
                              fontWeight: 700, 
                              background: '#8b5cf6', 
                              color: '#ffffff', 
                              padding: '0px 3px', 
                              borderRadius: '2px', 
                              lineHeight: '1.1',
                              letterSpacing: '0.3px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px'
                            }}
                            title={`Provisional Mode: Checking paused${sample.provisionalExpiry ? ` until ${formatTimeIST(sample.provisionalExpiry)}` : ''}`}
                          >
                            PROV
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '3px' }}>
                        <button 
                          onClick={() => toggleSampleMute(sample.id)}
                          disabled={!(sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated') || sample.isOverdue)}
                          style={{ 
                            background: 'transparent', 
                            border: 'none', 
                            color: mutedSamples.has(sample.id) ? 'var(--text-secondary)' : 'var(--warning)', 
                            cursor: (sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated') || sample.isOverdue) ? 'pointer' : 'default', 
                            padding: '1px',
                            opacity: (sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated') || sample.isOverdue) ? 1 : 0.2
                          }}
                          title={mutedSamples.has(sample.id) ? "Unmute Sample" : "Mute Sample"}
                        >
                          {mutedSamples.has(sample.id) ? <VolumeX size={11} /> : <Volume2 size={11} />}
                        </button>
                        <button 
                          onClick={() => setReceiveModal(sample.id)}
                          disabled={!(sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated'))}
                          style={{ 
                            background: 'transparent', 
                            border: 'none', 
                            color: 'var(--success)', 
                            cursor: (sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated')) ? 'pointer' : 'default', 
                            padding: '1px',
                            opacity: (sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated')) ? 1 : 0.2
                          }}
                          title="Mark as Received"
                        >
                          <CheckCircle size={11} />
                        </button>
                        <button 
                          onClick={() => handleEdit(sample.id, sample.barcode)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '1px' }}
                          title="Edit Barcode"
                        >
                          <Edit2 size={11} />
                        </button>
                        <button 
                          onClick={() => handleDelete(sample.id)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '1px' }}
                          title="Delete Sample"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', width: '94px' }}>
                      {(() => {
                        const state = getTriggerCountdownState(sample, Date.now());
                        return (
                          <div 
                            style={{ 
                              display: 'inline-flex', 
                              flexDirection: 'column', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              background: state.bg,
                              border: state.border,
                              borderRadius: '4px',
                              padding: '2px 5px',
                              minWidth: '82px',
                              boxSizing: 'border-box',
                              lineHeight: '1.15',
                              userSelect: 'none'
                            }}
                            title={`Status: ${sample.status}${state.formattedTime ? ` | Remaining: ${state.formattedTime}` : ''} | Stage: ${state.label}`}
                          >
                            {state.phase === 'completed' ? (
                              <span style={{
                                fontSize: '9.5px',
                                fontWeight: 600,
                                color: state.color,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                whiteSpace: 'nowrap'
                              }}>
                                <span style={{ fontSize: '10px' }}>✓</span>
                                <span>Completed</span>
                              </span>
                            ) : (
                              <>
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                  color: state.color,
                                  letterSpacing: '0.4px',
                                  whiteSpace: 'nowrap',
                                  lineHeight: '1.1'
                                }}>
                                  {state.formattedTime}
                                </span>
                                <span style={{
                                  fontSize: '7px',
                                  fontWeight: 700,
                                  color: state.color,
                                  opacity: 0.9,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.3px',
                                  whiteSpace: 'nowrap',
                                  lineHeight: '1'
                                }}>
                                  {state.label}
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })()}
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