import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const WEEK_DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

type BrDateInputProps = {
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localIsoDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getDatePart(value: string): string {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function getTimePart(value: string): string {
  const match = String(value || "").match(/[T ](\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function isoDateToDisplay(value: string): string {
  const match = getDatePart(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function valueToDisplay(value: string, withTime: boolean): string {
  const date = isoDateToDisplay(value);
  if (!date) return "";
  if (!withTime) return date;
  const time = getTimePart(value);
  return time ? `${date} ${time}` : date;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function displayToValue(text: string, withTime: boolean): string | null {
  const normalized = text.trim();
  if (!normalized) return "";
  const pattern = withTime
    ? /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/
    : /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const match = normalized.match(pattern);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isRealDate(year, month, day)) return null;

  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (!withTime) return date;

  const hour = match[4] == null ? 0 : Number(match[4]);
  const minute = match[5] == null ? 0 : Number(match[5]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${date}T${pad(hour)}:${pad(minute)}`;
}

function maskDateText(rawValue: string, withTime: boolean): string {
  const digits = rawValue.replace(/\D/g, "").slice(0, withTime ? 12 : 8);
  const dateDigits = digits.slice(0, 8);
  let result = "";
  if (dateDigits.length <= 2) result = dateDigits;
  else if (dateDigits.length <= 4) result = `${dateDigits.slice(0, 2)}/${dateDigits.slice(2)}`;
  else result = `${dateDigits.slice(0, 2)}/${dateDigits.slice(2, 4)}/${dateDigits.slice(4)}`;

  if (withTime && digits.length > 8) {
    const timeDigits = digits.slice(8, 12);
    result += ` ${timeDigits.slice(0, 2)}`;
    if (timeDigits.length > 2) result += `:${timeDigits.slice(2)}`;
  }
  return result;
}

function isoToDate(value: string): Date | null {
  const part = getDatePart(value);
  const match = part.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isBeforeMinOrAfterMax(dateIso: string, min?: string, max?: string): boolean {
  const minDate = getDatePart(min || "");
  const maxDate = getDatePart(max || "");
  if (minDate && dateIso < minDate) return true;
  if (maxDate && dateIso > maxDate) return true;
  return false;
}

function isValueOutsideRange(value: string, min: string | undefined, max: string | undefined, withTime: boolean): boolean {
  if (!value) return false;
  if (!withTime) return isBeforeMinOrAfterMax(getDatePart(value), min, max);
  const comparable = value.slice(0, 16);
  const minComparable = min && getDatePart(min) ? min.slice(0, 16) : "";
  const maxComparable = max && getDatePart(max) ? max.slice(0, 16) : "";
  if (minComparable && comparable < minComparable) return true;
  if (maxComparable && comparable > maxComparable) return true;
  return false;
}

function defaultTime(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function BrDateInput({
  value,
  onChange,
  withTime = false,
  min,
  max,
  required = false,
  disabled = false,
  className = "",
  placeholder,
  ariaLabel,
}: BrDateInputProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const [text, setText] = useState(() => valueToDisplay(value, withTime));
  const [invalid, setInvalid] = useState(false);
  const initialDate = isoToDate(value) || new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [draftDate, setDraftDate] = useState(getDatePart(value));
  const [draftTime, setDraftTime] = useState(getTimePart(value) || defaultTime());

  useEffect(() => {
    setText(valueToDisplay(value, withTime));
    setInvalid(false);
    const selected = isoToDate(value);
    if (selected) {
      setViewYear(selected.getFullYear());
      setViewMonth(selected.getMonth());
      setDraftDate(getDatePart(value));
      setDraftTime(getTimePart(value) || defaultTime());
    }
  }, [value, withTime]);

  const updatePopoverPosition = useCallback(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;

    const rect = root.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gutter = 8;
    const width = Math.max(0, Math.min(320, viewportWidth - gutter * 2));
    const left = Math.max(gutter, Math.min(rect.left, viewportWidth - width - gutter));
    const estimatedHeight = popoverRef.current?.offsetHeight || (withTime ? 430 : 350);

    let top = rect.bottom + gutter;
    if (top + estimatedHeight > viewportHeight - gutter) {
      top = Math.max(gutter, rect.top - estimatedHeight - gutter);
    }

    const maxHeight = Math.max(120, viewportHeight - top - gutter);
    setPopoverStyle({
      position: "fixed",
      top,
      left,
      width,
      maxHeight,
      overflowY: "auto",
      visibility: "visible",
    });
  }, [withTime]);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInput = rootRef.current?.contains(target);
      const clickedPopover = popoverRef.current?.contains(target);
      if (!clickedInput && !clickedPopover) setIsOpen(false);
    };

    const handleViewportChange = () => updatePopoverPosition();
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updatePopoverPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, viewMonth, viewYear, draftDate, withTime, updatePopoverPosition]);

  const days = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(viewYear, viewMonth, 1 - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return {
        date,
        iso: localIsoDate(date),
        inMonth: date.getMonth() === viewMonth,
      };
    });
  }, [viewMonth, viewYear]);

  const selectedDate = withTime ? draftDate || getDatePart(value) : getDatePart(value);
  const today = localIsoDate();

  function openCalendar() {
    if (disabled) return;
    const selected = isoToDate(value) || new Date();
    setViewYear(selected.getFullYear());
    setViewMonth(selected.getMonth());
    setDraftDate(getDatePart(value));
    setDraftTime(getTimePart(value) || defaultTime());
    setPopoverStyle({ visibility: "hidden" });
    setIsOpen(true);
  }

  function commitText() {
    const parsed = displayToValue(text, withTime);
    if (parsed === null) {
      setInvalid(Boolean(text.trim()));
      return;
    }
    if (parsed && isValueOutsideRange(parsed, min, max, withTime)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(parsed);
    setText(valueToDisplay(parsed, withTime));
  }

  function handleTextChange(raw: string) {
    const masked = maskDateText(raw, withTime);
    setText(masked);
    setInvalid(false);
    const parsed = displayToValue(masked, withTime);
    if (parsed !== null && (!parsed || !isValueOutsideRange(parsed, min, max, withTime))) onChange(parsed);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitText();
      if (!invalid) setIsOpen(false);
    } else if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      openCalendar();
    } else if (event.key === "Escape") {
      setIsOpen(false);
      setText(valueToDisplay(value, withTime));
      setInvalid(false);
    }
  }

  function chooseDate(dateIso: string) {
    if (isBeforeMinOrAfterMax(dateIso, min, max)) return;
    setInvalid(false);
    if (withTime) {
      setDraftDate(dateIso);
      return;
    }
    onChange(dateIso);
    setText(valueToDisplay(dateIso, false));
    setIsOpen(false);
  }

  function applyDateTime() {
    if (!draftDate || !/^\d{2}:\d{2}$/.test(draftTime)) return;
    const next = `${draftDate}T${draftTime}`;
    if (isValueOutsideRange(next, min, max, true)) {
      setInvalid(true);
      return;
    }
    onChange(next);
    setText(valueToDisplay(next, true));
    setInvalid(false);
    setIsOpen(false);
  }

  function moveMonth(offset: number) {
    const target = new Date(viewYear, viewMonth + offset, 1);
    setViewYear(target.getFullYear());
    setViewMonth(target.getMonth());
  }

  function clearDate() {
    onChange("");
    setText("");
    setDraftDate("");
    setInvalid(false);
    setIsOpen(false);
  }

  const effectivePlaceholder = placeholder || (withTime ? "DD/MM/AAAA HH:mm" : "DD/MM/AAAA");

  const popover = isOpen && typeof document !== "undefined" ? createPortal(
    <div ref={popoverRef} className="brDatePopover brDatePopoverPortal" style={popoverStyle} role="dialog" aria-label="Selecionar data">
      <div className="brDateHeader">
        <button type="button" onClick={() => moveMonth(-1)} aria-label="Mês anterior">‹</button>
        <strong>{MONTH_NAMES[viewMonth]} {viewYear}</strong>
        <button type="button" onClick={() => moveMonth(1)} aria-label="Próximo mês">›</button>
      </div>

      <div className="brDateWeekDays" aria-hidden="true">
        {WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}
      </div>

      <div className="brDateGrid">
        {days.map(({ date, iso, inMonth }) => {
          const blocked = isBeforeMinOrAfterMax(iso, min, max);
          const isSelected = iso === selectedDate;
          const isToday = iso === today;
          return (
            <button
              key={iso}
              type="button"
              className={`${inMonth ? "" : "isOutside"} ${isSelected ? "isSelected" : ""} ${isToday ? "isToday" : ""}`.trim()}
              disabled={blocked}
              onClick={() => chooseDate(iso)}
              aria-label={`${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`}
              aria-pressed={isSelected}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {withTime ? (
        <div className="brDateTimeRow">
          <label>
            <span>Horário</span>
            <input
              type="time"
              min={draftDate && draftDate === getDatePart(min || "") ? getTimePart(min || "") || undefined : undefined}
              max={draftDate && draftDate === getDatePart(max || "") ? getTimePart(max || "") || undefined : undefined}
              value={draftTime}
              onChange={(event) => { setDraftTime(event.target.value); setInvalid(false); }}
            />
          </label>
          <button className="brDateApplyButton" type="button" disabled={!draftDate || !draftTime} onClick={applyDateTime}>Aplicar</button>
        </div>
      ) : null}

      <div className="brDateFooter">
        <button type="button" onClick={() => chooseDate(today)} disabled={isBeforeMinOrAfterMax(today, min, max)}>Hoje</button>
        <button type="button" onClick={clearDate}>Limpar</button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div ref={rootRef} className={`brDateInput ${className}`.trim()}>
        <div className={`brDateInputControl ${invalid ? "isInvalid" : ""} ${disabled ? "isDisabled" : ""}`}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            placeholder={effectivePlaceholder}
            aria-label={ariaLabel || effectivePlaceholder}
            aria-invalid={invalid}
            required={required}
            disabled={disabled}
            maxLength={withTime ? 16 : 10}
            onChange={(event) => handleTextChange(event.target.value)}
            onBlur={() => commitText()}
            onKeyDown={handleInputKeyDown}
          />
          {text && !disabled ? (
            <button className="brDateClearButton" type="button" onMouseDown={(event) => event.preventDefault()} onClick={clearDate} aria-label="Limpar data">×</button>
          ) : null}
          <button className="brDateCalendarButton" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => isOpen ? setIsOpen(false) : openCalendar()} disabled={disabled} aria-label="Abrir calendário" aria-expanded={isOpen}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 3v3M17 3v3M4.5 9.5h15M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {invalid ? <small className="brDateError">Use o formato {withTime ? "DD/MM/AAAA HH:mm" : "DD/MM/AAAA"}.</small> : null}
      </div>
      {popover}
    </>
  );
}
