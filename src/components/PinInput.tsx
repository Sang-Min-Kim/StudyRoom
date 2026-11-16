import React, { useRef } from 'react';

interface PinInputProps {
  value: string;
  onChange: (next: string) => void;
  idPrefix: string;
  autoFocusFirst?: boolean;
}

export const PinInput: React.FC<PinInputProps> = ({
  value,
  onChange,
  idPrefix,
  autoFocusFirst = false,
}) => {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = [0, 1, 2, 3].map((idx) => value[idx] || '');

  const handleDigitChange = (idx: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) {
      const nextArr = [...digits];
      nextArr[idx] = '';
      onChange(nextArr.join(''));
      return;
    }

    if (cleaned.length > 1) {
      const merged = (value.slice(0, idx) + cleaned).replace(/\D/g, '').slice(0, 4);
      onChange(merged);
      const focusIdx = Math.min(merged.length, 3);
      refs.current[focusIdx]?.focus();
      return;
    }

    const nextArr = [...digits];
    nextArr[idx] = cleaned;
    onChange(nextArr.join(''));
    if (idx < 3) {
      refs.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[idx] && idx > 0) {
        e.preventDefault();
        const nextArr = [...digits];
        nextArr[idx - 1] = '';
        onChange(nextArr.join(''));
        refs.current[idx - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      refs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < 3) {
      e.preventDefault();
      refs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (text) {
      e.preventDefault();
      onChange(text);
      const targetIdx = Math.min(text.length, 3);
      refs.current[targetIdx]?.focus();
    }
  };

  return (
    <div className="grid grid-cols-4 gap-2.5 sm:gap-3" role="group" aria-label="4자리 강의 번호">
      {[0, 1, 2, 3].map((idx) => (
        <input
          key={idx}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          id={`${idPrefix}-${idx}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={4}
          autoFocus={autoFocusFirst && idx === 0}
          value={digits[idx]}
          aria-label={`강의 번호 ${idx + 1}번째 자리`}
          onChange={(e) => handleDigitChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.currentTarget.select()}
          className="h-13 sm:h-14 w-full rounded-xl border border-slate-200 bg-slate-50/70 text-center font-mono text-xl sm:text-2xl font-bold tracking-widest text-slate-900 tabular-nums transition-colors focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/15"
        />
      ))}
    </div>
  );
};
