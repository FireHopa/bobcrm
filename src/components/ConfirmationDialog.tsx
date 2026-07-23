import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ModalDialog } from "./ModalDialog";

export type ConfirmationOptions = {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmationDialogProps = ConfirmationOptions & {
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmationDialog({
  title,
  message,
  detail,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  return (
    <ModalDialog
      title={title}
      description={tone === "danger" ? "Revise antes de continuar." : undefined}
      onClose={onCancel}
      size="small"
      tone={tone}
      footer={(
        <>
          <button className="secondaryButton" type="button" onClick={onCancel}> {cancelLabel} </button>
          <button
            className={tone === "danger" ? "dangerButton" : "primaryButton"}
            type="button"
            data-dialog-initial-focus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      )}
    >
      <div className="confirmationDialogCopy">
        <strong>{message}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
    </ModalDialog>
  );
}

export function useConfirmationDialog(): {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
  confirmationDialog: ReactNode;
} {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((nextOptions: ConfirmationOptions) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  useEffect(() => () => resolverRef.current?.(false), []);

  return {
    confirm,
    confirmationDialog: options ? (
      <ConfirmationDialog
        {...options}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    ) : null,
  };
}
