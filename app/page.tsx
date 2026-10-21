"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { saveBarcodeToDatabase, getAllTrackedSamples, clearAllSamples, deleteSample, updateSampleBarcode, markSampleReceived, extendSampleTime, simulateFalseTrigger, toggleSampleProvisional, retrySampleCheck, triggerBarcodeCheckServer, markCheckFailed } from './actions';
import { getDepartments } from './actions/departments';
import { DatePicker } from './components/DatePicker';
import { Edit2, Trash2, Barcode, CheckCircle, Volume2, VolumeX, X as XIcon, ChevronDown, Bell, Search, RefreshCw } from 'lucide-react';
import { useSearch } from './context/SearchContext';
import { formatTimeIST, formatDateIST, getTodayDateIST } from './lib/dateUtils';
import { normalizeStatus, isBatchSample } from './lib/statusUtils';

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
  phase: 'initial_check' | 'in_progress' | 'check_failed' | 'awaiting_intake' | 'result_due' | 'verify_due' | 'completed';
  label: string;
  formattedTime: string;
  isOverdue: boolean;
  isBlinking?: boolean;
  bg: string;
  color: string;
  border: string;
}

export function getTriggerCountdownState(sample: Sample, nowMs: number): TriggerCountdownState {
  const sLower = (sample.status || '').toLowerCase();
  const tests = Array.isArray(sample.testDetails) ? sample.testDetails : [];

  // Stage 5: Finished
  // Check if all tests completed according to their individual rules:
  // Tests with verification configured require verification; tests without verification terminate at Result Done.
  const allTestsDoneOrVerified = tests.length > 0 && tests.every((td: any) => {
    const ds = (td.status || '').toLowerCase();
    const isApprovedOrVerified = ds.includes('verified') || ds.includes('approved') || ds.includes('authorized') || ds.includes('dispatch');
    const isDone = isApprovedOrVerified || ds.includes('result done') || ds.includes('done') || ds.includes('completed');
    if (td.intervalTimeVerified == null || td.intervalTimeVerified <= 0) {
      return isDone;
    }
    return isApprovedOrVerified;
  });

  const isVerifiedOrDispatched = Boolean(
    sample.isCompleted ||
    allTestsDoneOrVerified ||
    sLower.includes('verified') ||
    sLower.includes('approved') ||
    sLower.includes('authorized') ||
    sLower.includes('dispatch')
  );

  // 1. Stage: Verified / Dispatched (All workflow milestones completed -> Green Completed Badge)
  if (isVerifiedOrDispatched) {
    return {
      phase: 'completed',
      label: 'Completed',
      formattedTime: '',
      isOverdue: false,
      bg: 'rgba(16, 185, 129, 0.15)',
      color: '#10b981',
      border: '1px solid rgba(16, 185, 129, 0.4)'
    };
  }

  // Check intake status:
  const hasValidReceivedTimestamp = Boolean(
    (sample.rawReceivedTime && sample.rawReceivedTime !== '--') ||
    (sample.receivedDate && sample.receivedDate !== '--') ||
    ((sample as any).receivedTime && (sample as any).receivedTime !== '--')
  );

  const isReceivedStageOrLater = hasValidReceivedTimestamp || 
    sLower.includes('received') || 
    sLower.includes('done') || 
    sLower.includes('verified') || 
    sLower.includes('approved') || 
    sLower.includes('dispatch');

  // Pre-Intake Stages (Stage 1 & Stage 2)
  if (!isReceivedStageOrLater) {
    const rawScan = sample.rawCreatedAt || (sample as any).createdAt;
    const scanMs = rawScan ? new Date(rawScan).getTime() : 0;
    const safeScanMs = isNaN(scanMs) ? 0 : scanMs;
    // Strict Toggle Evaluation: If triggerTime is null, undefined, or 0, delay is strictly 0 mins (no fallback to 2 mins)
    const trigMins = (sample.triggerTime != null && sample.triggerTime > 0) ? sample.triggerTime : 0;
    let initialCheckTargetMs = (safeScanMs > 0 && trigMins > 0) ? (safeScanMs + trigMins * 60000) : 0;
    if (trigMins > 0 && initialCheckTargetMs === 0 && sample.nextCheckTime) {
      const nctMs = new Date(sample.nextCheckTime).getTime();
      if (!isNaN(nctMs)) initialCheckTargetMs = nctMs;
    }

    const isPendingCheckStatus = sLower.includes('pending check') || sLower.includes('scanned');
    const diffSecs = initialCheckTargetMs > 0 ? Math.ceil((initialCheckTargetMs - nowMs) / 1000) : 0;

    // Condition 1: Timer Counting Down (Pending Check with trigger enabled and diffSecs > 0)
    if (isPendingCheckStatus && trigMins > 0 && diffSecs > 0) {
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
    }

    // Condition 2: Timer Hits 00:00 OR Trigger Disabled (Check Dispatched / In Progress / Checking...)
    const isChecking = sLower.includes('checking') || (isPendingCheckStatus && trigMins === 0) || (isPendingCheckStatus && diffSecs <= 0 && diffSecs >= -20);
    if (isChecking) {
      return {
        phase: 'in_progress',
        label: 'In Progress',
        formattedTime: 'Checking...',
        isOverdue: false,
        isBlinking: false,
        bg: 'rgba(6, 182, 212, 0.12)',
        color: '#06b6d4',
        border: '1px solid rgba(6, 182, 212, 0.35)'
      };
    }

    // Condition 3: Check Times Out / Extension No Response / Failed
    const isCheckFailed = sLower.includes('check failed') || sLower.includes('extension not responding') || sLower.includes('failed') || sLower.includes('offline') || (isPendingCheckStatus && trigMins > 0 && diffSecs < -20);
    if (isCheckFailed) {
      return {
        phase: 'check_failed',
        label: 'Retry Check',
        formattedTime: '',
        isOverdue: false,
        isBlinking: false,
        bg: 'rgba(100, 116, 139, 0.15)',
        color: 'var(--text-secondary)',
        border: '1px solid rgba(100, 116, 139, 0.35)'
      };
    }

    // Condition 4: Real Sample Collected / Batch Generated
    // STRICT GUARD: Must strictly be real Sample Collected or Batch Generated, never incomplete/failed
    const isCollectedReal = (
      sLower === 'sample collected' ||
      sLower === 'batch generated' ||
      (sLower.includes('collected') && !sLower.includes('uncollected')) ||
      (sLower.includes('batch') && !sLower.includes('failed'))
    ) && !sLower.includes('pending') && !sLower.includes('checking') && !sLower.includes('failed');

    if (isCollectedReal) {
      return {
        phase: 'awaiting_intake',
        label: 'Awaiting Intake',
        formattedTime: '',
        isOverdue: true,
        isBlinking: true,
        bg: 'rgba(239, 68, 68, 0.2)',
        color: '#ef4444',
        border: '1px solid rgba(239, 68, 68, 0.5)'
      };
    }

    // Default neutral pre-intake fallback
    return {
      phase: 'check_failed',
      label: 'Retry Check',
      formattedTime: '',
      isOverdue: false,
      isBlinking: false,
      bg: 'rgba(100, 116, 139, 0.15)',
      color: 'var(--text-secondary)',
      border: '1px solid rgba(100, 116, 139, 0.35)'
    };
  }

  // Calculate base received timestamp for SLA clocks
  const rawScan = sample.rawCreatedAt || (sample as any).createdAt;
  const rawReceived = (sample.rawReceivedTime && sample.rawReceivedTime !== '--') 
    ? sample.rawReceivedTime 
    : ((sample as any).receivedTime && (sample as any).receivedTime !== '--' ? (sample as any).receivedTime : null);
  const receivedMs = rawReceived
    ? new Date(rawReceived).getTime()
    : (rawScan ? new Date(rawScan).getTime() : nowMs);
  const safeReceivedMs = isNaN(receivedMs) ? nowMs : receivedMs;

  const isSampleResultDoneOrLater = sLower.includes('result done') || 
    sLower.includes('verified') || 
    sLower.includes('approved') || 
    sLower.includes('dispatch') || 
    Boolean(sample.isCompleted);

  // Find tests awaiting Result Done
  const pendingResultTests = tests.filter((td: any) => {
    const ds = (td.status || '').toLowerCase();
    const isDone = Boolean(td.isDone) || 
      ds.includes('result done') || 
      ds.includes('done') || 
      ds.includes('completed') || 
      ds.includes('verified') || 
      ds.includes('approved') || 
      ds.includes('dispatch') ||
      isSampleResultDoneOrLater;
    return !isDone;
  });

  const isAwaitingResults = !isSampleResultDoneOrLater && (pendingResultTests.length > 0 || tests.length === 0);

  // 3. Stage: Sample Received (Awaiting test results -> Live countdown to earliest pending Result SLA)
  if (isAwaitingResults) {
    let earliestDeadline = Infinity;
    if (tests.length > 0) {
      for (const td of pendingResultTests) {
        const interval = td.intervalTime != null ? td.intervalTime : (sample.intervalTime || 10);
        const extra = td.extraTime || 0;
        const testDeadline = safeReceivedMs + (interval + extra) * 60000;
        if (testDeadline < earliestDeadline) {
          earliestDeadline = testDeadline;
        }
      }
    } else {
      const interval = sample.intervalTime || 10;
      earliestDeadline = safeReceivedMs + interval * 60000;
    }

    if (earliestDeadline === Infinity) earliestDeadline = safeReceivedMs + 10 * 60000;

    const diffSecs = Math.floor((earliestDeadline - nowMs) / 1000);
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

  // All results are done! Stage: Result Done
  // Check if any test has Verified (Mins) configured and is awaiting verification
  const pendingVerifTests = tests.filter((td: any) => {
    const ds = (td.status || '').toLowerCase();
    const isApprovedOrVerified = Boolean(td.isVerified) || ds.includes('verified') || ds.includes('approved') || ds.includes('authorized') || ds.includes('dispatch');
    const hasVerif = td.intervalTimeVerified != null && td.intervalTimeVerified > 0;
    return hasVerif && !isApprovedOrVerified;
  });

  const hasConfiguredVerif = pendingVerifTests.length > 0 || (
    tests.length === 0 && sample.intervalTimeVerified != null && sample.intervalTimeVerified > 0 && !sLower.includes('verified')
  );

  // 4. Stage: Result Done with Verified (Mins) configured -> Live countdown to Verification SLA
  if (hasConfiguredVerif) {
    let earliestVerifDeadline = Infinity;
    if (tests.length > 0) {
      for (const td of pendingVerifTests) {
        const testResultMs = td.resultTime ? new Date(td.resultTime).getTime() : (sample.rawResultTime ? new Date(sample.rawResultTime).getTime() : safeReceivedMs);
        const safeBaseMs = isNaN(testResultMs) ? nowMs : testResultMs;
        const testVerifDeadline = safeBaseMs + td.intervalTimeVerified * 60000;
        if (testVerifDeadline < earliestVerifDeadline) {
          earliestVerifDeadline = testVerifDeadline;
        }
      }
    } else {
      const resultBaseMs = sample.rawResultTime ? new Date(sample.rawResultTime).getTime() : safeReceivedMs;
      const safeBaseMs = isNaN(resultBaseMs) ? nowMs : resultBaseMs;
      earliestVerifDeadline = safeBaseMs + (sample.intervalTimeVerified || 15) * 60000;
    }

    if (earliestVerifDeadline === Infinity) earliestVerifDeadline = nowMs + 15 * 60000;

    const diffSecs = Math.floor((earliestVerifDeadline - nowMs) / 1000);
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

  // 5. Stage: Result Done with NO Verified (Mins) configured -> Completed (Green Badge)
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
  const [receiveModal, setReceiveModal] = useState<Sample | null>(null);
  const [receiveResultCompleted, setReceiveResultCompleted] = useState<boolean>(false);
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
        const isPreCheck = !receivedDateObj && (
          statusLower.includes('pending check') || 
          statusLower.includes('scanned') || 
          statusLower.includes('waiting') || 
          statusLower.includes('collected') || 
          statusLower.includes('batch generated')
        );

        // Parse and evaluate individual test SLAs dynamically against persistent timestamps
        const rawTestDetails = s.testDetails ? (() => { try { return JSON.parse(s.testDetails); } catch { return []; } })() : [];

        const testDetails = rawTestDetails.map((td: any) => {
          const ds = (td.status || '').toLowerCase();
          const isApproved = ds.includes('approved') || ds.includes('authorized') || ds.includes('dispatch');
          const isVerified = isApproved || ds.includes('verified');
          const isDone = isVerified || ds.includes('done') || ds.includes('completed');

          // Multi-Test pre-intake check:
          const isUncollected = ds.includes('collected') || ds.includes('batch generated') || ds.includes('uncollected') || ds.includes('pending collection') || ((statusLower.includes('collected') || statusLower.includes('batch')) && !isDone && !ds.includes('received'));

          // 1. Result Entry SLA Tracking:
          // Measured from sample_received_time using Test Config -> Result Done (Mins).
          let isResultOverdue = false;
          let isResultOverdueAfterExtraTime = false;
          if (receivedDateObj && !isPreCheck && !isDone) {
            const resultEntryMins = td.intervalTime != null ? td.intervalTime : (s.intervalTime || 10);
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
          // Case 1: No verification time set (Verified (Mins) is null, blank, or 0 in Test Config):
          // Terminates tracking at Result Done. Mark completed!
          // Case 2: Verification time is configured:
          // Calculate: verification_deadline = result_done_time + test_config.verified_mins.
          let isVerificationOverdue = false;
          let isTestCompleted = false;

          if (isDone) {
            if (td.intervalTimeVerified == null || td.intervalTimeVerified <= 0) {
              isTestCompleted = true;
            } else {
              if (isVerified) {
                isTestCompleted = true;
              } else {
                const baseTime = td.resultTime ? new Date(td.resultTime) : (resultDateObj || receivedDateObj);
                if (baseTime) {
                  const verificationDeadline = new Date(baseTime.getTime() + td.intervalTimeVerified * 60000);
                  if (now > verificationDeadline) {
                    isVerificationOverdue = true;
                  }
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
            isApproved,
            isTestCompleted,
            isUncollected
          };
        });

        // Fallback if sample has no testDetails array:
        const fallbackIsVerified = statusLower.includes('verified') || statusLower.includes('approved') || statusLower.includes('dispatch');
        const fallbackIsDone = fallbackIsVerified || statusLower.includes('done') || statusLower.includes('completed');

        let fallbackResultOverdue = false;
        if (testDetails.length === 0 && receivedDateObj && !isPreCheck && !fallbackIsDone) {
          const limit = new Date(receivedDateObj.getTime() + (s.intervalTime || 10) * 60000);
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
        const isCompleted = testDetails.length > 0 
          ? testDetails.every((t: any) => t.isTestCompleted)
          : Boolean(s.isCompleted || fallbackIsVerified || (fallbackIsDone && (s.intervalTimeVerified == null || s.intervalTimeVerified <= 0)));

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
          intervalTime: s.intervalTime ?? (testDetails.length > 0 ? Math.min(...testDetails.map((t: any) => t.intervalTime || 10)) : 10),
          intervalTimeVerified: s.intervalTimeVerified !== undefined ? s.intervalTimeVerified : (testDetails.length > 0 && testDetails.some((t: any) => t.intervalTimeVerified != null) ? Math.min(...testDetails.filter((t: any) => t.intervalTimeVerified != null).map((t: any) => t.intervalTimeVerified)) : null),
          target: '--',
          delayPercent: 0,
          departments: (s.departments && s.departments.length > 0) ? s.departments : ['HAEMATOLOGY'],
          isOverdue: !isCompleted && (
            isResultOverdue || isVerificationOverdue ||
            (s.expectedEndTime && new Date() > new Date(s.expectedEndTime))
          ),
          isOverdueAfterExtraTime: !isCompleted && (
            (s.expectedEndTime && new Date() > new Date(s.expectedEndTime)) || 
            (!s.expectedEndTime && s.receivedTime && new Date().getTime() - new Date(s.receivedTime).getTime() > 15 * 60000)
          ) && (testDetails.length > 0 ? testDetails.some((t: any) => t.extraTime && t.extraTime > 0) : false),
          isTriggerOverdue: false,
          isResultOverdue,
          isVerificationOverdue,
          isProvisional: Boolean(s.isProvisional),
          provisionalTime: s.provisionalTime,
          provisionalExpiry: s.provisionalExpiry,
          isCompleted: isCompleted,
        };
      });
      setSamples(prev => {
        // Prevent table reset flicker: preserve any in-flight optimistic samples not yet in formattedSamples
        const pendingOptimistic = prev.filter(p => 
          p.id.startsWith('temp-') && !formattedSamples.some(f => f.barcode === p.barcode)
        );
        if (pendingOptimistic.length === 0) {
          return formattedSamples;
        }
        return [...pendingOptimistic, ...formattedSamples];
      });
    } catch (error) {
      console.warn("Polling error (Server might be restarting):", error);
    }
  }, [selectedDate]);

  // 1-second live ticker to keep countdowns and timers updating live on screen
  const [liveTick, setLiveTick] = useState(0);
  const dispatchedBarcodesRef = useRef<Set<string>>(new Set());
  const checkDispatchedTimeRef = useRef<Map<string, number>>(new Map());
  const ackReceivedBarcodesRef = useRef<Set<string>>(new Set());

  // Communication Bridge: Dispatch lookup to browser extension / background worker
  const triggerExtensionCheck = useCallback((barcode: string, departmentId?: string, departmentTriggerTime?: number) => {
    // Diagnostic log specified in requirements:
    console.log('[Dashboard] Dispatching check event for barcode:', barcode);
    console.log(`[Dashboard] Trigger timer expired for barcode: ${barcode}. Sending lookup request...`);

    const payload = {
      barcode,
      departmentId: departmentId || 'HAEMATOLOGY',
      departmentTriggerTime: departmentTriggerTime ?? 0,
      timestamp: new Date().toISOString()
    };

    // Track dispatch timestamp for extension response timeout handling
    checkDispatchedTimeRef.current.set(barcode, Date.now());

    if (typeof window !== 'undefined') {
      // 1. Post message to window (content.js listening)
      window.postMessage({
        type: 'CHECK_BARCODE_DATA',
        action: 'SEARCH_BARCODE',
        ...payload
      }, '*');

      window.postMessage({
        type: 'LIS_TAT_TRIGGER_CHECK',
        action: 'SEARCH_BARCODE',
        ...payload
      }, '*');

      // 2. Dispatch custom DOM events
      window.dispatchEvent(new CustomEvent('CHECK_BARCODE_DATA', { detail: payload }));
      window.dispatchEvent(new CustomEvent('LIS_TAT_TRIGGER_CHECK', { detail: payload }));

      // 3. Direct chrome runtime if injected in same context
      try {
        const winAny = window as any;
        if (typeof winAny.chrome !== 'undefined' && winAny.chrome?.runtime?.sendMessage) {
          winAny.chrome.runtime.sendMessage({
            action: 'CHECK_BARCODE_DATA',
            ...payload
          }, () => {
            if (winAny.chrome.runtime.lastError) { /* ignore */ }
          });
        }
      } catch (e) {
        // Ignore
      }
    }
  }, []);

  const dispatchExtensionLookup = triggerExtensionCheck;

  // Check timers every second: countdown timer expiration & 8-10s timeout handling
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveTick(t => t + 1);

      const nowMs = Date.now();
      samples.forEach(sample => {
        const sLower = (sample.status || '').toLowerCase();
        const isPreCheck = sLower.includes('pending check') || sLower.includes('scanned');

        if (isPreCheck && (!sample.receivedDate || sample.receivedDate === '--')) {
          // Calculate remaining time
          const rawScan = sample.rawCreatedAt || (sample as any).createdAt;
          const scanMs = rawScan ? new Date(rawScan).getTime() : 0;
          const safeScanMs = isNaN(scanMs) ? 0 : scanMs;
          const trigMins = (sample.triggerTime != null && sample.triggerTime > 0) ? sample.triggerTime : 0;
          let targetMs = (safeScanMs > 0 && trigMins > 0) ? (safeScanMs + trigMins * 60000) : 0;
          if (targetMs === 0 && sample.nextCheckTime) {
            const nctMs = new Date(sample.nextCheckTime).getTime();
            if (!isNaN(nctMs)) targetMs = nctMs;
          }

          const diffSecs = targetMs > 0 ? Math.ceil((targetMs - nowMs) / 1000) : 0;

          // When remainingTime <= 0 on a pre-check barcode, actively dispatch trigger event to extension
          if (diffSecs <= 0 && !dispatchedBarcodesRef.current.has(sample.barcode)) {
            dispatchedBarcodesRef.current.add(sample.barcode);
            checkDispatchedTimeRef.current.set(sample.barcode, Date.now());

            // Update sample in local state to Checking... with Fetching from LIS...
            setSamples(prev => prev.map(s => {
              if (s.barcode === sample.barcode) {
                return {
                  ...s,
                  status: 'Checking...',
                  test: (!s.test || s.test === 'Resolving...' || s.test === 'Waiting...') ? 'Fetching from LIS...' : s.test
                };
              }
              return s;
            }));

            // Actively dispatch lookup
            triggerExtensionCheck(sample.barcode, sample.departments?.[0], sample.triggerTime ?? 0);

            // Update status on server
            triggerBarcodeCheckServer(sample.id, sample.barcode).catch(() => {});
          }
        }

        // Extension Response & Timeout Handling:
        // If checking has been active for >= 8 seconds without response, mark as Extension Not Responding or Check Failed
        if (sLower.includes('checking') && (!sample.receivedDate || sample.receivedDate === '--')) {
          const dispatchMs = checkDispatchedTimeRef.current.get(sample.barcode);
          const fallbackCheckMs = sample.nextCheckTime ? new Date(sample.nextCheckTime).getTime() : 0;
          const effectiveDispatchMs = dispatchMs || fallbackCheckMs;

          if (effectiveDispatchMs > 0 && (nowMs - effectiveDispatchMs >= 8000)) {
            checkDispatchedTimeRef.current.delete(sample.barcode);
            const failureReason = ackReceivedBarcodesRef.current.has(sample.barcode) ? 'Check Failed' : 'Extension Not Responding';
            setSamples(prev => prev.map(s => {
              if (s.barcode === sample.barcode) {
                return {
                  ...s,
                  status: failureReason,
                  test: (!s.test || s.test === 'Fetching from LIS...' || s.test === 'Resolving...' || s.test === 'Waiting...') ? 'Not Found' : s.test
                };
              }
              return s;
            }));

            // Persist to server so polling doesn't overwrite with 'Checking...'
            markCheckFailed(sample.id, sample.barcode, failureReason).catch(() => {});
          }
        }
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [samples, triggerExtensionCheck]);

  // Retry check handler for [Retry Check] button
  const handleRetryCheck = useCallback(async (sample: Sample) => {
    dispatchedBarcodesRef.current.delete(sample.barcode);
    ackReceivedBarcodesRef.current.delete(sample.barcode);
    checkDispatchedTimeRef.current.set(sample.barcode, Date.now());

    // Update locally to Checking... immediately
    setSamples(prev => prev.map(s => {
      if (s.barcode === sample.barcode || s.id === sample.id) {
        return {
          ...s,
          status: 'Checking...',
          test: 'Fetching from LIS...'
        };
      }
      return s;
    }));

    // Dispatch lookup
    triggerExtensionCheck(sample.barcode, sample.departments?.[0], sample.triggerTime ?? 0);

    // Server action
    await retrySampleCheck(sample.id, sample.barcode);

    // Re-fetch shortly after
    setTimeout(() => loadRealData(), 1500);
  }, [triggerExtensionCheck, loadRealData]);

  // Listen for extension status updates and acknowledgments relayed to the window
  useEffect(() => {
    const handleAck = (e: any) => {
      const barcode = e?.detail?.barcode || e?.data?.barcode;
      if (barcode) {
        ackReceivedBarcodesRef.current.add(String(barcode).trim());
        console.log('[Dashboard] Received ACK from extension for barcode:', barcode);
      }
    };

    const handleWindowMessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object') {
        if (e.data.type === 'EXTENSION_ACK' && e.data.barcode) {
          ackReceivedBarcodesRef.current.add(String(e.data.barcode).trim());
          console.log('[Dashboard] Received ACK from extension for barcode:', e.data.barcode);
        } else if (e.data.type === 'LIS_STATUS_UPDATED') {
          loadRealData();
        }
      }
    };

    window.addEventListener('EXTENSION_ACK', handleAck as any);
    window.addEventListener('LIS_STATUS_UPDATED', () => loadRealData());
    window.addEventListener('message', handleWindowMessage);

    return () => {
      window.removeEventListener('EXTENSION_ACK', handleAck as any);
      window.removeEventListener('LIS_STATUS_UPDATED', () => loadRealData());
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [loadRealData]);

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
    
    // Strict Toggle Evaluation:
    // If trigger_enabled === false OR trigger_time === 0 (or null/undefined), delay is strictly 0 mins (no fallback to 2 mins)
    // Only if trigger_enabled === true and triggerTime > 0, use configured duration.
    const isTriggerEnabled = Boolean(currentDept && currentDept.triggerTime != null && currentDept.triggerTime > 0);
    const delayMins = isTriggerEnabled ? (currentDept!.triggerTime as number) : 0;

    let cleanBarcode = currentInput;
    let requestedTests: string[] = [];
    if (cleanBarcode.includes(':')) {
      const parts = cleanBarcode.split(':');
      cleanBarcode = parts[0].trim();
      const testsPart = parts.slice(1).join(':').trim();
      if (testsPart) {
        requestedTests = testsPart.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    let defaultTestDetails: any[] = [];
    if (requestedTests.length > 0) {
      defaultTestDetails = requestedTests.map(t => ({
        name: t,
        status: delayMins > 0 ? "Pending Check" : "Checking...",
        intervalTime: 10,
        intervalTimeVerified: 15,
        department: effectiveDept,
        isUncollected: false
      }));
    } else {
      defaultTestDetails = [];
    }

    const defaultTestName = defaultTestDetails.length > 0 
      ? defaultTestDetails.map(t => t.name).join(', ') 
      : (delayMins > 0 ? "Resolving..." : "Fetching from LIS...");

    const initialStatus = delayMins > 0 ? "Pending Check" : "Checking...";

    // Immediately create the row with actual order details
    const optimisticSample: Sample = {
      id: `temp-${cleanBarcode}-${Date.now()}`,
      barcode: cleanBarcode,
      patient: "--",
      test: defaultTestName,
      serviceCd: requestedTests.length > 0 ? requestedTests.join(', ') : `DEPT:${effectiveDept}`,
      status: initialStatus,
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
      nextCheckTime: delayMins > 0 ? new Date(now.getTime() + delayMins * 60000).toISOString() : null,
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

    setSamples(prev => [optimisticSample, ...prev.filter(s => s.barcode !== cleanBarcode)]);

    // When Trigger is Disabled (delay === 0):
    // Call triggerExtensionCheck(barcode) IMMEDIATELY in the scan handler right after row creation!
    if (delayMins === 0) {
      triggerExtensionCheck(cleanBarcode, effectiveDept, 0);
      dispatchedBarcodesRef.current.add(cleanBarcode);
      checkDispatchedTimeRef.current.set(cleanBarcode, Date.now());
    }

    try {
      const response = await saveBarcodeToDatabase(currentInput, effectiveDept);
      
      if (response.success && response.sample) {
        const triggerDelay = response.triggerDelayMins ?? delayMins;
        setScanNotice({ barcode: cleanBarcode, delayMins: triggerDelay });
        setTimeout(() => setScanNotice(null), 5000);

        // Seamless in-place reconciliation: update optimistic row with real DB data
        setSamples(prev => prev.map(s => {
          if (s.barcode === cleanBarcode || s.id === optimisticSample.id) {
            return {
              ...s,
              id: response.sample!.id,
              rawCreatedAt: response.sample!.createdAt ? new Date(response.sample!.createdAt).toISOString() : s.rawCreatedAt,
              nextCheckTime: response.sample!.nextCheckTime ? new Date(response.sample!.nextCheckTime).toISOString() : s.nextCheckTime,
              departments: (s.departments && s.departments.length > 0) ? s.departments : [effectiveDept]
            };
          }
          return s;
        }));

        if (delayMins === 0) {
          triggerBarcodeCheckServer(response.sample.id, cleanBarcode).catch(() => {});
        }

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
      // STRICT GUARD: Only activate collected alarm if strictly confirmed Sample Collected or Batch Generated!
      // Incomplete check, Checking..., Check Failed, or missing response must NEVER trigger alarm!
      const isCollected = (
        sLower === 'sample collected' || 
        sLower === 'batch generated' || 
        (sLower.includes('collected') && !sLower.includes('uncollected')) || 
        (sLower.includes('batch') && !sLower.includes('failed'))
      ) && !sLower.includes('pending') && !sLower.includes('checking') && !sLower.includes('failed') && !sLower.includes('received');

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
    const targetId = receiveModal.id;
    const isCompleted = receiveResultCompleted;
    setReceiveModal(null);
    const res = await markSampleReceived(targetId, isCompleted);
    if (res.success && res.sample) {
      await loadRealData();
    } else {
      alert(res.message || "Failed to mark as received.");
      await loadRealData();
    }
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const handleFalseTrigger = async (id: string, type: 'trigger' | 'result' | 'verification' | 'collected') => {
    const res = await simulateFalseTrigger(id, type);
    if (res.success && res.sample) {
      await loadRealData();
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
    const s = (status || '').toLowerCase();
    if (s.includes('checking')) return 'checking';
    if (s.includes('check failed') || s.includes('failed') || s.includes('offline') || s.includes('not found') || s.includes('extension not responding')) return 'check-failed';
    if (s.includes('scanned') || s.includes('pending check') || s.includes('waiting')) return 'pending-check';
    if (s.includes('batch')) return 'batch';
    if (s.includes('collected')) return 'collected';
    if (s.includes('received')) return 'received';
    if (s.includes('pending')) return 'pending';
    if (s.includes('completed') || s.includes('done') || s.includes('verified') || s.includes('approved')) return 'completed';
    return 'default';
  };

  const getCardStatusClass = (sample: Sample) => {
    if (sample.isProvisional) return 'status-provisional';
    const s = sample.status.toLowerCase();

    // 1. Pre-check during delay: neutral info, NO danger alert
    if (s.includes('pending check') || s.includes('scanned')) {
      return 'status-pending-check';
    }

    // 2. Checking in progress: neutral cyan, NO danger alert
    if (s.includes('checking')) {
      return 'status-checking';
    }

    // 3. Check failed / extension offline / extension not responding: warning gray, NO danger alert
    if (s.includes('check failed') || s.includes('failed') || s.includes('offline') || s.includes('extension not responding')) {
      return 'status-check-failed';
    }

    // 4. Critical Pre-Intake state: ONLY if strictly confirmed Sample Collected or Batch Generated!
    // NEVER apply danger highlight unless valid API/extension response explicitly returns Sample Collected or Batch Generated!
    const isCollectedAlert = (
      s === 'sample collected' || 
      s === 'batch generated' || 
      (s.includes('collected') && !s.includes('uncollected')) || 
      (s.includes('batch') && !s.includes('failed'))
    ) && !s.includes('pending') && !s.includes('checking') && !s.includes('failed') && !s.includes('received') && !s.includes('extension not responding');

    if (isCollectedAlert) return 'status-collected';

    if (sample.isOverdueAfterExtraTime) return 'status-overdue-critical';
    if (sample.isResultOverdue) return 'status-result-overdue';
    if (sample.isVerificationOverdue) return 'status-verification-overdue';
    if (sample.isTriggerOverdue) return 'status-overdue';
    if (sample.isOverdue) return 'status-overdue';
    if (sample.isCompleted || s.includes('completed') || s.includes('verified') || s.includes('approved') || s.includes('dispatch')) return 'status-completed';
    if (s.includes('pending')) return 'status-pending';
    if (s.includes('waiting')) return 'status-waiting';
    return '';
  };

  const sampleMatchesDate = useCallback((sample: Sample) => {
    if (!selectedDate) return true;
    const [year, month, day] = selectedDate.split('-').map(Number);
    const startObj = new Date(year, month - 1, day);
    startObj.setHours(0, 0, 0, 0);
    const endObj = new Date(year, month - 1, day);
    endObj.setHours(23, 59, 59, 999);

    const checkMatch = (dateStr?: string | null) => {
      if (!dateStr || dateStr === '--') return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      d.setHours(12, 0, 0, 0);
      return d >= startObj && d <= endObj;
    };

    if (sample.rawCreatedAt) {
      const d = new Date(sample.rawCreatedAt);
      if (!isNaN(d.getTime())) {
        if (d >= startObj && d <= endObj) return true;
      }
    }

    return checkMatch(sample.receivedDate) || checkMatch(sample.resultDate) || checkMatch(sample.entryDate);
  }, [selectedDate]);

  // Samples belonging to departments the logged-in user has access to
  const userAccessibleSamples = useMemo(() => {
    return samples.filter(sample => {
      if (user?.username === 'admin') return true;
      if (!sample.departments || sample.departments.length === 0) return true;
      return sample.departments.some(dName => departments.some(dept => dept.name.toLowerCase() === dName.toLowerCase()));
    });
  }, [samples, user, departments]);

  // Base samples for the selected department tab matching date
  const selectedDeptSamples = useMemo(() => {
    return userAccessibleSamples.filter(sample => {
      const matchesDept = activeTab 
        ? (!sample.departments || sample.departments.length === 0 || sample.departments.some(d => d.toLowerCase() === activeTab.toLowerCase())) 
        : true;
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
      s.departments && s.departments.some(d => d.toLowerCase() === deptName.toLowerCase()) && sampleMatchesDate(s)
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
      matchesDepartment = (!sample.departments || sample.departments.length === 0)
        ? true
        : sample.departments.some(d => d.toLowerCase() === activeTab.toLowerCase());
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
                  <tr key={sample.barcode || sample.id} className={`table-row ${getCardStatusClass(sample)}`}>
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

                            const isRowDanger = sample.status.toLowerCase().includes('collected') || sample.status.toLowerCase().includes('batch generated') || (sample.testDetails && sample.testDetails.some((d: any) => d.isUncollected));
                            const isTestUncollected = Boolean((td.isUncollected || isRowDanger) && !isDone && !isVerified);

                            let bg = 'rgba(255, 255, 255, 0.05)';
                            let anim = 'none';
                            let border = '1px solid var(--border-color)';
                            let color = 'var(--text-primary)';

                            if (isVerificationOverdue) {
                              anim = 'blinkPurple 1.5s infinite ease-in-out';
                              bg = 'rgba(139, 92, 246, 0.25)';
                              border = '1px solid #a855f7';
                              color = '#c084fc';
                            } else if (isExtraOverdue) {
                              anim = 'blinkRed 1s infinite ease-in-out';
                              bg = 'rgba(239, 68, 68, 0.25)';
                              border = '1px solid #ef4444';
                              color = '#ef4444';
                            } else if (isResultOverdue) {
                              anim = 'blinkAlert 1.5s infinite ease-in-out';
                              bg = 'rgba(239, 68, 68, 0.25)';
                              border = '1px solid #ef4444';
                              color = '#ef4444';
                            } else if (isRowDanger && isTestUncollected) {
                              // Critical pre-intake state: highlight specifically each uncollected test badge
                              anim = 'blinkRedAlert 2s infinite ease-in-out';
                              bg = 'rgba(239, 68, 68, 0.28)';
                              border = '1px solid #ef4444';
                              color = '#fca5a5';
                            } else if (isDone) {
                              // Reached Result Done within allowed time
                              anim = 'none';
                              bg = 'rgba(16, 185, 129, 0.12)';
                              border = '1px solid rgba(16, 185, 129, 0.28)';
                              color = 'var(--success)';
                            } else {
                              // Normal styling for already collected/received test
                              anim = 'none';
                              bg = 'rgba(255, 255, 255, 0.05)';
                              border = '1px solid var(--border-color)';
                              color = 'var(--text-primary)';
                            }

                            const canExtend = isResultOverdue || isExtraOverdue || isVerificationOverdue;

                            const isResolving = td.name === 'Resolving...' || td.name === 'Fetching Test...';
                            const isFetching = td.name === 'Fetching from LIS...';
                            const isNotFound = td.name === 'Not Found';
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
                            if (isFetching) {
                              return (
                                <span 
                                  key={i}
                                  style={{
                                    fontStyle: 'italic',
                                    color: '#06b6d4',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    fontSize: '9px',
                                    fontWeight: 500
                                  }}
                                  title="Actively retrieving test details from LIS"
                                >
                                  <span style={{ display: 'inline-block', width: '7px', height: '7px', border: '1.5px solid #06b6d4', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
                                  <span>Fetching from LIS...</span>
                                </span>
                              );
                            }
                            if (isNotFound) {
                              return (
                                <span 
                                  key={i}
                                  style={{
                                    color: 'var(--text-secondary)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    fontSize: '9px',
                                    opacity: 0.85
                                  }}
                                  title="Test not found in LIS"
                                >
                                  <span>⚠️</span>
                                  <span>Not Found</span>
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
                          } else if ((statusLower.includes('collected') || statusLower.includes('batch')) && !fallbackIsDone) {
                            fallbackAnim = 'blinkRedAlert 2s infinite ease-in-out';
                            fallbackBg = 'rgba(239, 68, 68, 0.28)';
                            fallbackBorder = '1px solid #ef4444';
                            fallbackColor = '#fca5a5';
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
                              ) : sample.test === 'Fetching from LIS...' ? (
                                <span style={{ fontStyle: 'italic', color: '#06b6d4', display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 500 }}>
                                  <span style={{ display: 'inline-block', width: '7px', height: '7px', border: '1.5px solid #06b6d4', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
                                  <span>Fetching from LIS...</span>
                                </span>
                              ) : sample.test === 'Not Found' ? (
                                <span style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '3px', opacity: 0.85 }}>
                                  <span>⚠️</span>
                                  <span>Not Found</span>
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
                          {normalizeStatus(sample.status, sample.barcode, sample.test)}
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
                        {(() => {
                          const s = sample.status.toLowerCase();
                          const isAlreadyReceived = s.includes('received') || s.includes('result done') || s.includes('done') || s.includes('verified') || s.includes('approved') || s.includes('dispatch') || sample.isCompleted;
                          const isEligibleForReceive = !isAlreadyReceived || s.includes('collected') || s.includes('batch generated') || s.includes('pending check') || s.includes('scanned') || sample.receivedDate === '--';

                          return (
                            <button 
                              onClick={() => {
                                if (isEligibleForReceive) {
                                  setReceiveModal(sample);
                                  setReceiveResultCompleted(false);
                                }
                              }}
                              disabled={!isEligibleForReceive}
                              style={{ 
                                background: 'transparent', 
                                border: 'none', 
                                color: isEligibleForReceive ? 'var(--success)' : 'var(--text-secondary)', 
                                cursor: isEligibleForReceive ? 'pointer' : 'default', 
                                padding: '1px',
                                opacity: isEligibleForReceive ? 1 : 0.2
                              }}
                              title={isEligibleForReceive ? "Mark Sample as Received in Lab" : "Already Received"}
                            >
                              <CheckCircle size={11} />
                            </button>
                          );
                        })()}
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
                              userSelect: 'none',
                              animation: state.isBlinking ? 'pulseBlink 1.5s infinite ease-in-out' : 'none'
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
                            ) : state.phase === 'check_failed' ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRetryCheck(sample);
                                }}
                                className="btn-retry-check"
                                style={{
                                  background: 'rgba(148, 163, 184, 0.15)',
                                  border: '1px solid rgba(148, 163, 184, 0.4)',
                                  color: 'var(--text-primary)',
                                  padding: '2px 7px',
                                  borderRadius: '4px',
                                  fontSize: '9px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  whiteSpace: 'nowrap',
                                  lineHeight: '1.2'
                                }}
                                title="Click to retry querying LIS for this barcode"
                              >
                                <RefreshCw size={10} />
                                <span>Retry Check</span>
                              </button>
                            ) : state.phase === 'in_progress' ? (
                              <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '1px'
                              }}>
                                <span style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  color: state.color,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  whiteSpace: 'nowrap'
                                }}>
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', border: '1.5px solid #06b6d4', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
                                  <span>{state.formattedTime || 'Checking...'}</span>
                                </span>
                                <span style={{
                                  fontSize: '7px',
                                  fontWeight: 600,
                                  color: state.color,
                                  opacity: 0.85,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.3px',
                                  whiteSpace: 'nowrap'
                                }}>
                                  Querying LIS...
                                </span>
                              </div>
                            ) : state.phase === 'awaiting_intake' ? (
                              <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '1px'
                              }}>
                                <span style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  color: state.color,
                                  letterSpacing: '0.2px',
                                  whiteSpace: 'nowrap',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px'
                                }}>
                                  <span>⚠️</span>
                                  <span>Awaiting Intake</span>
                                </span>
                                <span style={{
                                  fontSize: '7px',
                                  fontWeight: 700,
                                  color: state.color,
                                  opacity: 0.9,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.4px',
                                  whiteSpace: 'nowrap'
                                }}>
                                  Needs Receive
                                </span>
                              </div>
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
          <div className="modal-content" style={{ maxWidth: '480px', width: '92%' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                  <CheckCircle size={18} />
                </div>
                <div>
                  <h3 className="modal-title" style={{ margin: 0, fontSize: '1.1rem', lineHeight: '1.2' }}>Mark Sample as Received</h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Lab intake confirmation & SLA activation</span>
                </div>
              </div>
              <button 
                onClick={() => { setReceiveModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '4px' }}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ margin: 0 }}>
              {/* Sample Summary */}
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Barcode</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{receiveModal.barcode}</span>
                </div>
                {receiveModal.patient && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Patient</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>{receiveModal.patient}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Status</span>
                  {(() => {
                    const normStatus = normalizeStatus(receiveModal.status, receiveModal.barcode, receiveModal.test);
                    const isCollectedModal = normStatus.toLowerCase().includes('collected') || normStatus.toLowerCase().includes('batch');
                    return (
                      <span style={{ 
                        fontSize: '0.75rem', 
                        padding: '2px 8px', 
                        borderRadius: '4px', 
                        fontWeight: 600,
                        background: isCollectedModal ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        color: isCollectedModal ? '#ef4444' : 'var(--accent-primary)',
                        border: isCollectedModal ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(59, 130, 246, 0.3)'
                      }}>
                        {normStatus}
                      </span>
                    );
                  })()}
                </div>

                {/* Tests & SLAs */}
                {receiveModal.testDetails && receiveModal.testDetails.length > 0 && (
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      Configured Tests ({receiveModal.testDetails.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {receiveModal.testDetails.map((td: any, i: number) => (
                        <div 
                          key={i}
                          style={{
                            fontSize: '0.75rem',
                            padding: '3px 7px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{td.testName || td.testCode || `Test ${i + 1}`}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                            (Result: {td.intervalTime ?? receiveModal.intervalTime ?? 0}m{td.intervalTimeVerified ? `, Verif: ${td.intervalTimeVerified}m` : ''})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Result Completed Toggle Card */}
              <label 
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '8px',
                  border: receiveResultCompleted ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid var(--border-color)',
                  background: receiveResultCompleted ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  userSelect: 'none',
                  marginBottom: '1.5rem'
                }}
              >
                <input 
                  type="checkbox"
                  checked={receiveResultCompleted}
                  onChange={e => setReceiveResultCompleted(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    marginTop: '2px',
                    cursor: 'pointer',
                    accentColor: '#10b981'
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: receiveResultCompleted ? '#10b981' : 'var(--text-primary)' }}>
                      Result Completed
                    </span>
                    {receiveResultCompleted && (
                      <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '3px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', fontWeight: 600 }}>
                        BYPASS RESULT SLA
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {receiveResultCompleted 
                      ? "Immediately sets test status to Result Done, bypassing the Result SLA countdown. If verification SLA is configured, begins Phase 3 Verification tracking starting now."
                      : "Transitions status to Sample Received and begins counting down the Result Done SLA from the current timestamp."
                    }
                  </p>
                </div>
              </label>
            </div>

            <div className="modal-actions" style={{ gap: '0.75rem' }}>
              <button 
                className="btn-secondary" 
                onClick={() => { setReceiveModal(null); setTimeout(() => inputRef.current?.focus(), 10); }}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                style={receiveResultCompleted ? { background: '#10b981' } : {}}
                onClick={confirmMarkReceived}
              >
                {receiveResultCompleted ? "Confirm (Result Done)" : "Confirm Received"}
              </button>
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