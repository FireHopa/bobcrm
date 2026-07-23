import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ActionMenuItem = {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect?: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
};

type ActionMenuProps = {
  items: ActionMenuItem[];
  ariaLabel: string;
  triggerContent?: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  showChevron?: boolean;
  align?: "start" | "end";
};

type MenuPosition = {
  top: number;
  left: number;
  maxHeight: number;
};

const VIEWPORT_GUTTER = 10;
const MENU_GAP = 7;

function DotsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
      <circle cx="4" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="16" cy="10" r="1.6" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ActionMenu({
  items,
  ariaLabel,
  triggerContent,
  triggerClassName = "actionMenuIconTrigger",
  menuClassName = "",
  disabled = false,
  showChevron = false,
  align = "end",
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0, maxHeight: 360 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const availableItems = useMemo(() => items.filter(Boolean), [items]);

  function closeMenu({ restoreFocus = false } = {}) {
    setIsOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function calculatePosition() {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = menu?.offsetWidth || 248;
    const menuHeight = menu?.offsetHeight || Math.min(availableItems.length * 54 + 12, 360);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const desiredLeft = align === "start" ? triggerRect.left : triggerRect.right - menuWidth;
    const left = Math.max(VIEWPORT_GUTTER, Math.min(desiredLeft, viewportWidth - menuWidth - VIEWPORT_GUTTER));

    const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_GUTTER;
    const spaceAbove = triggerRect.top - VIEWPORT_GUTTER;
    const shouldOpenAbove = menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, shouldOpenAbove ? spaceAbove - MENU_GAP : spaceBelow - MENU_GAP);
    const top = shouldOpenAbove
      ? Math.max(VIEWPORT_GUTTER, triggerRect.top - Math.min(menuHeight, maxHeight) - MENU_GAP)
      : Math.min(triggerRect.bottom + MENU_GAP, viewportHeight - VIEWPORT_GUTTER);

    setPosition({ top, left, maxHeight });
  }

  useLayoutEffect(() => {
    if (!isOpen) return;
    calculatePosition();

    const firstEnabledItem = menuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)');
    firstEnabledItem?.focus();
  }, [isOpen, availableItems.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu({ restoreFocus: true });
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const menuButtons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') || []);
      if (!menuButtons.length) return;

      event.preventDefault();
      const currentIndex = menuButtons.indexOf(document.activeElement as HTMLButtonElement);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex === -1
        ? 0
        : (currentIndex + direction + menuButtons.length) % menuButtons.length;
      menuButtons[nextIndex]?.focus();
    };

    const handleViewportChange = () => calculatePosition();

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, availableItems.length]);

  async function handleSelect(item: ActionMenuItem) {
    if (item.disabled || !item.onSelect) return;
    closeMenu();
    await item.onSelect();
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={triggerClassName}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        disabled={disabled}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        {triggerContent || <DotsIcon />}
        {showChevron ? <ChevronIcon /> : null}
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className={`actionMenuPopover ${menuClassName}`.trim()}
            role="menu"
            aria-label={ariaLabel}
            style={{ top: position.top, left: position.left, maxHeight: position.maxHeight }}
          >
            {availableItems.map((item) => (
              <div className={item.separatorBefore ? "actionMenuItemWrap actionMenuSeparator" : "actionMenuItemWrap"} key={item.id}>
                <button
                  className={`actionMenuItem ${item.danger ? "actionMenuItemDanger" : ""}`.trim()}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => void handleSelect(item)}
                >
                  {item.icon ? <span className="actionMenuItemIcon">{item.icon}</span> : null}
                  <span className="actionMenuItemCopy">
                    <strong>{item.label}</strong>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
