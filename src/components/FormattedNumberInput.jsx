import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Format a raw digit string with commas for display.
 * @param {string} raw - Digits only (or digits + one decimal part for allowDecimals)
 * @param {boolean} allowDecimals
 * @returns {string}
 */
function formatWithCommas(raw, allowDecimals = false) {
  if (raw === '' || raw == null) return '';
  if (allowDecimals) {
    const parts = String(raw).split('.');
    const intPart = (parts[0] || '').replace(/\D/g, '');
    const decPart = (parts[1] || '').replace(/\D/g, '').slice(0, 2);
    if (intPart === '') return decPart ? '0.' + decPart : '';
    const intFormatted = parseInt(intPart, 10).toLocaleString();
    if (decPart === '') return intFormatted;
    return intFormatted + '.' + decPart;
  }
  const digits = String(raw).replace(/\D/g, '');
  if (digits === '') return '';
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? '' : n.toLocaleString();
}

/**
 * Parse input value to raw string (digits only, or digits.decimals).
 * @param {string} input - What user typed (may include commas)
 * @param {boolean} allowDecimals
 * @returns {string}
 */
function parseRaw(input, allowDecimals = false) {
  const s = String(input ?? '').replace(/,/g, '');
  if (allowDecimals) {
    const parts = s.split('.');
    const intPart = (parts[0] || '').replace(/\D/g, '');
    const decPart = (parts[1] || '').replace(/\D/g, '').slice(0, 2);
    if (decPart === '') return intPart === '' ? '' : intPart;
    return intPart + '.' + decPart;
  }
  return (s.replace(/\D/g, ''));
}

/**
 * FormattedNumberInput - shows commas as user types.
 * value: string (raw digits, e.g. "10000" or "")
 * onChange: (rawValue: string) => void
 * allowDecimals: boolean - if true, allow one decimal point (e.g. money with cents)
 */
const FormattedNumberInput = React.forwardRef(function FormattedNumberInput(
  { value, onChange, allowDecimals = false, max, className, type, ...props },
  ref
) {
  const innerRef = React.useRef(null);
  const cursorRef = React.useRef(null);
  const mergedRef = React.useCallback(
    (node) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const raw = value === undefined || value === null ? '' : String(value);
  const display = formatWithCommas(raw, allowDecimals);

  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || cursorRef.current == null) return;
    el.setSelectionRange(cursorRef.current, cursorRef.current);
    cursorRef.current = null;
  });

  const handleChange = (e) => {
    const el = e.target;
    const prev = display;
    const next = el.value;
    const caretBefore = el.selectionStart ?? next.length;

    let nextRaw = parseRaw(next, allowDecimals);
    if (!allowDecimals && max != null && nextRaw !== '') {
      const n = parseInt(nextRaw, 10);
      if (!Number.isNaN(n) && n > max) {
        nextRaw = String(max);
      }
    }

    const nextDisplay = formatWithCommas(nextRaw, allowDecimals);

    const digitsBefore = next.slice(0, caretBefore).replace(/[^0-9.]/g, '').length;
    let newCaret = 0;
    let counted = 0;
    for (let i = 0; i < nextDisplay.length; i++) {
      if (counted >= digitsBefore) break;
      if (/[0-9.]/.test(nextDisplay[i])) counted++;
      newCaret = i + 1;
    }
    cursorRef.current = newCaret;

    onChange(nextRaw);
  };

  return (
    <input
      ref={mergedRef}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      className={cn(className)}
      {...props}
    />
  );
});

FormattedNumberInput.displayName = 'FormattedNumberInput';

export { FormattedNumberInput, formatWithCommas, parseRaw };
