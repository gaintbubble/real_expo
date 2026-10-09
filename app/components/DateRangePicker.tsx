"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X } from 'lucide-react';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
}

export function DateRangePicker({ startDate, endDate, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectionStep, setSelectionStep] = useState<'start' | 'end'>('start');
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (selectionStep === 'end' && !endDate) {
          // If they click out while picking end, reset to just start=start, end=start
          onChange(startDate, startDate);
        }
        setSelectionStep('start');
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [startDate, endDate, selectionStep, onChange]);

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const paddingDays = Array.from({ length: firstDayOfMonth }, (_, i) => i);

  const handleDateSelect = (day: number) => {
    const selected = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const year = selected.getFullYear();
    const month = String(selected.getMonth() + 1).padStart(2, '0');
    const d = String(selected.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${d}`;
    
    if (selectionStep === 'start' || (startDate && endDate)) {
      // Start fresh
      onChange(dateStr, '');
      setSelectionStep('end');
    } else {
      // End step
      const startObj = new Date(startDate);
      const endObj = new Date(dateStr);
      if (endObj < startObj) {
        onChange(dateStr, startDate);
      } else {
        onChange(startDate, dateStr);
      }
      setIsOpen(false);
      setSelectionStep('start');
    }
  };

  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let displayStr = "Select dates";
  if (startDate && endDate) {
    if (startDate === endDate) {
       displayStr = startDate;
    } else {
       displayStr = `${startDate} - ${endDate}`;
    }
  } else if (startDate) {
    displayStr = `${startDate} - ?`;
  }

  const isDateInRange = (dateStr: string) => {
    if (!startDate) return false;
    const d = new Date(dateStr);
    const s = new Date(startDate);
    const e = endDate ? new Date(endDate) : hoverDate ? new Date(hoverDate) : null;
    
    if (e) {
      if (s <= e) return d >= s && d <= e;
      else return d >= e && d <= s;
    }
    return false;
  };

  return (
    <div className="custom-datepicker" ref={containerRef} style={{ position: 'relative' }}>
      <div 
        className="header-search" 
        style={{ width: '220px', padding: '0.35rem 0.75rem', margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <CalendarIcon size={16} className="search-icon" style={{ margin: 0, flexShrink: 0 }} />
          <span style={{ fontSize: '0.85rem', color: (startDate || endDate) ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayStr}
          </span>
        </div>
        {(startDate || endDate) && (
          <X 
            size={14} 
            style={{ color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }} 
            onClick={(e) => {
              e.stopPropagation();
              onChange('', '');
              setSelectionStep('start');
            }}
          />
        )}
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          marginTop: '8px',
          right: 0,
          width: '280px',
          background: 'var(--glass-bg, #1e293b)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.05))',
          borderRadius: '12px',
          padding: '1rem',
          boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.5)',
          zIndex: 50,
          animation: 'fadeInDown 0.2s ease-out'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <button onClick={prevMonth} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px' }} className="icon-btn">
              <ChevronLeft size={18} />
            </button>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </div>
            <button onClick={nextMonth} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px' }} className="icon-btn">
              <ChevronRight size={18} />
            </button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0px', textAlign: 'center', marginBottom: '8px' }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <div key={day} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{day}</div>
            ))}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0px', rowGap: '4px' }}>
            {paddingDays.map(i => <div key={`pad-${i}`} />)}
            {days.map(day => {
              const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              
              const isStart = startDate === dateStr;
              const isEnd = endDate === dateStr;
              const inRange = isDateInRange(dateStr);
              const isToday = new Date().toDateString() === new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day).toDateString();
              
              let bg = 'transparent';
              if (isStart || isEnd) bg = 'var(--accent-primary, #3b82f6)';
              else if (inRange) bg = 'rgba(59, 130, 246, 0.2)';

              let borderRadius = '8px';
              if (inRange && !isStart && !isEnd) borderRadius = '0px';
              if (isStart && endDate && startDate !== endDate) borderRadius = '8px 0 0 8px';
              if (isEnd && startDate && startDate !== endDate) borderRadius = '0 8px 8px 0';
              if (startDate && !endDate && hoverDate) {
                 const sDate = new Date(startDate);
                 const hDate = new Date(hoverDate);
                 const d = new Date(dateStr);
                 if (sDate < hDate && isStart) borderRadius = '8px 0 0 8px';
                 else if (sDate > hDate && isStart) borderRadius = '0 8px 8px 0';
                 else if (sDate < hDate && dateStr === hoverDate) borderRadius = '0 8px 8px 0';
                 else if (sDate > hDate && dateStr === hoverDate) borderRadius = '8px 0 0 8px';
              }

              return (
                <div 
                  key={day}
                  onClick={() => handleDateSelect(day)}
                  onMouseEnter={() => setHoverDate(dateStr)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '32px',
                    width: '100%',
                    borderRadius,
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    background: bg,
                    color: (isStart || isEnd) ? 'white' : (isToday ? 'var(--accent-primary)' : 'var(--text-primary)'),
                    fontWeight: (isStart || isEnd || isToday) ? 600 : 400,
                    transition: 'all 0.1s'
                  }}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
