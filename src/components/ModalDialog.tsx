import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type ModalDialogProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
  dismissOnBackdrop?: boolean;
  size?: "small" | "medium" | "large";
  tone?: "default" | "danger";
  className?: string;
};

export function ModalDialog({
  title,
  description,
  children,
  footer,
  onClose,
  closeLabel = "Fechar diálogo",
  closeDisabled = false,
  dismissOnBackdrop = true,
  size = "medium",
  tone = "default",
  className = "",
}: ModalDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousActiveElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const animationFrame = window.requestAnimationFrame(() => {
      const initialFocus = dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        || dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        || dialogRef.current;
      initialFocus?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => previousActiveElementRef.current?.focus(), 0);
    };
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !closeDisabled) {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) || [],
    ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    if (!focusableElements.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="crmDialogOverlay crmDialogOverlayV5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && dismissOnBackdrop && !closeDisabled) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`crmDialog crmDialog-${size} crmDialog-${tone} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="crmDialogHeader">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            className="crmDialogClose"
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            disabled={closeDisabled}
          >
            ×
          </button>
        </header>

        <div className="crmDialogBody">{children}</div>
        {footer ? <footer className="crmDialogFooter">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}
