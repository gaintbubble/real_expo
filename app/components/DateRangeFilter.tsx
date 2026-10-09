"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronDown, Check, ChevronLeft, ChevronRight } from 'lucide-react';

interface DateRange {
  from: Date | null;
  to: Date | null;
  label: string;
}

interface DateRangeFilterProps {
  onFilterChange: (range: DateRange) => void;
  initialRange?: DateRange;
}

const MiniCalendar = ({ value, onChange, label }: { value: Date | null, onChange: (d: Date) => void, label: string }) => {
  const [viewDate, setViewDate] = useState(value || new Date());

  useEffect(() => {
    if (value) {
      setViewDate((prev) => {
        if (prev.getMonth() !== value.getMonth() || prev.getFullYear() !== value.getFullYear()) {
          return new Date(value.getFullYear(), value.getMonth(), 1);
        }
        return prev;
      });
    }
  }, [value]);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);
  
  const months = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ];

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const startDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();

  const handlePrevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));

  const handleMonthSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewDate(new Date(viewDate.getFullYear(), parseInt(e.target.value), 1));
  };
  const handleYearSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewDate(new Date(parseInt(e.target.value), viewDate.getMonth(), 1));
  };

  const days = [];
  for (let i = 0; i < startDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), i));

  const isSelected = (d: Date) => {
    return value && d.getDate() === value.getDate() && d.getMonth() === value.getMonth() && d.getFullYear() === value.getFullYear();
  };
  const isToday = (d: Date) => {
    const today = new Date();
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  };

  return (
    <div style={{ width: '260px', padding: '0.5rem', background: 'transparent', borderRadius: '8px' }}>
      <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem', textAlign: 'center' }}>
        {label}
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <button onClick={handlePrevMonth} className="icon-btn" style={{ width: '24px', height: '24px' }}><ChevronLeft size={14}/></button>
        <div style={{ display: 'flex', gap: '4px' }}>
          <select value={viewDate.getMonth()} onChange={handleMonthSelect} style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', appearance: 'none', textAlign: 'center' }}>
            {months.map((m, i) => <option key={m} value={i} style={{ color: '#000' }}>{m}</option>)}
          </select>
          <select value={viewDate.getFullYear()} onChange={handleYearSelect} style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', appearance: 'none', textAlign: 'center' }}>
            {years.map(y => <option key={y} value={y} style={{ color: '#000' }}>{y}</option>)}
          </select>
        </div>
        <button onClick={handleNextMonth} className="icon-btn" style={{ width: '24px', height: '24px' }}><ChevronRight size={14}/></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '4px' }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} style={{ fontSize: '10px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 500 }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {days.map((d, idx) => (
          <div key={idx} style={{ height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {d ? (
              <button
                onClick={() => onChange(d)}
                style={{
                  width: '24px', height: '24px', borderRadius: '50%', fontSize: '11px', fontWeight: 500,
                  transition: 'all 0.2s', border: 'none', cursor: 'pointer',
                  background: isSelected(d) ? 'var(--accent-primary)' : 'transparent',
                  color: isSelected(d) ? '#fff' : isToday(d) ? 'var(--accent-primary)' : 'var(--text-primary)'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected(d)) e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected(d)) e.currentTarget.style.background = 'transparent';
                }}
              >
                {d.getDate()}
              </button>
            ) : <div />}
          </div>
        ))}
      </div>
    </div>
  );
};

export function DateRangeFilter({ onFilterChange, initialRange }: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activePreset, setActivePreset] = useState('Today');
  const [displayLabel, setDisplayLabel] = useState('Today'); 
  
  const [tempFrom, setTempFrom] = useState<Date | null>(new Date());
  const [tempTo, setTempTo] = useState<Date | null>(new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialRange && initialRange.label) {
        setDisplayLabel(initialRange.label);
        setTempFrom(initialRange.from);
        setTempTo(initialRange.to);
        const presets = ['Today', 'Yesterday', 'Last 7 Days', 'Month to Date', 'Last Month', 'Year to Date', 'Last Year', 'Specific Date', 'Date Range'];
        if (presets.includes(initialRange.label)) setActivePreset(initialRange.label);
        else setActivePreset(initialRange.from?.getTime() === initialRange.to?.getTime() ? 'Specific Date' : 'Date Range');
    }
  }, [initialRange?.from, initialRange?.to, initialRange?.label]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const presets = ['Today', 'Yesterday', 'Last 7 Days', 'Month to Date', 'Last Month', 'Year to Date', 'Last Year', 'Specific Date', 'Date Range'];

  const handlePresetClick = (preset: string) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let from: Date | null = null;
    let to: Date | null = null;

    if (preset === 'Specific Date' || preset === 'Date Range') {
        setActivePreset(preset);
        return;
    }

    switch (preset) {
      case 'Today': from = today; to = today; break;
      case 'Yesterday':
        from = new Date(today); from.setDate(today.getDate() - 1);
        to = from; break;
      case 'Last 7 Days':
        from = new Date(today); from.setDate(today.getDate() - 6);
        to = today; break;
      case 'Month to Date':
        from = new Date(today.getFullYear(), today.getMonth(), 1); to = today; break;
      case 'Last Month':
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0); break;
      case 'Year to Date':
        from = new Date(today.getFullYear(), 0, 1); to = today; break;
      case 'Last Year':
        from = new Date(today.getFullYear() - 1, 0, 1);
        to = new Date(today.getFullYear() - 1, 11, 31); break;
    }

    setActivePreset(preset);
    setDisplayLabel(preset); 
    if (from) setTempFrom(from);
    if (to) setTempTo(to);
    onFilterChange({ from, to, label: preset });
    setIsOpen(false);
  };

  const applyCustomRange = () => {
    if (!tempFrom) return;
    let from = tempFrom;
    let to = activePreset === 'Specific Date' ? tempFrom : (tempTo || tempFrom);
    const format = (d: Date | null) => d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    let label = activePreset === 'Specific Date' ? format(from) : `${format(from)} - ${format(to)}`;

    setActivePreset(activePreset); 
    setDisplayLabel(label); 
    onFilterChange({ from, to, label });
    setIsOpen(false);
  };

  return (
    <div style={{ position: 'relative' }} ref={containerRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="header-search"
        style={{ width: '220px', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '20px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <CalendarIcon size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayLabel}
            </span>
        </div>
        <ChevronDown size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }}/>
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '8px',
          background: 'var(--glass-bg)', backdropFilter: 'blur(12px)',
          borderRadius: '12px', border: '1px solid var(--glass-border)',
          boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)', zIndex: 50,
          display: 'flex', flexDirection: 'row', overflow: 'hidden',
          animation: 'fadeInDown 0.2s ease-out'
        }}>
          {/* Sidebar Presets */}
          <div style={{ width: '160px', background: 'rgba(15,23,42,0.4)', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
            {presets.map(preset => (
              <button
                key={preset}
                onClick={() => handlePresetClick(preset)}
                style={{
                  textAlign: 'left', padding: '0.75rem 1rem', fontSize: '0.8rem', fontWeight: 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: activePreset === preset ? 'rgba(255,255,255,0.05)' : 'transparent',
                  color: activePreset === preset ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  border: 'none', borderLeft: activePreset === preset ? '3px solid var(--accent-primary)' : '3px solid transparent',
                  cursor: 'pointer', transition: 'all 0.2s'
                }}
                onMouseEnter={e => { if (activePreset !== preset) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                onMouseLeave={e => { if (activePreset !== preset) e.currentTarget.style.background = 'transparent'; }}
              >
                {preset}
                {activePreset === preset && <Check size={14}/>}
              </button>
            ))}
          </div>
          
          {/* Calendar Area */}
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '300px' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                {activePreset === 'Specific Date' ? (
                    <MiniCalendar label="Select Date" value={tempFrom} onChange={(d) => { setTempFrom(d); setActivePreset('Specific Date'); }} />
                ) : (
                    <>
                        <MiniCalendar label="From Date" value={tempFrom} onChange={(d) => { setTempFrom(d); setActivePreset('Date Range'); }} />
                        <div style={{ width: '1px', background: 'var(--border-color)', alignSelf: 'stretch', margin: '0 0.5rem' }}></div>
                        <MiniCalendar label="To Date" value={tempTo} onChange={(d) => { setTempTo(d); setActivePreset('Date Range'); }} />
                    </>
                )}
            </div>

            {['Specific Date', 'Date Range'].includes(activePreset) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', marginTop: '1rem', gap: '0.5rem' }}>
                    <button onClick={() => setIsOpen(false)} className="btn-secondary">Cancel</button>
                    <button onClick={applyCustomRange} className="btn-primary">Apply Filter</button>
                </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
