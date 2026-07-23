import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type FeedbackTone = "success" | "info" | "error";

type FeedbackDetail = {
  message: string;
  tone?: FeedbackTone;
};

type FeedbackState = FeedbackDetail & {
  key: number;
};

const FEEDBACK_EVENT = "crm-action-feedback";

export function notifyAction(message: string, tone: FeedbackTone = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FeedbackDetail>(FEEDBACK_EVENT, { detail: { message, tone } }));
}

export function ActionFeedbackHost() {
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const handleFeedback = (event: Event) => {
      const customEvent = event as CustomEvent<FeedbackDetail>;
      const message = customEvent.detail?.message?.trim();
      if (!message) return;

      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      setFeedback({ message, tone: customEvent.detail.tone || "success", key: Date.now() });
      timeoutRef.current = window.setTimeout(() => setFeedback(null), 2600);
    };

    window.addEventListener(FEEDBACK_EVENT, handleFeedback);
    return () => {
      window.removeEventListener(FEEDBACK_EVENT, handleFeedback);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!feedback || typeof document === "undefined") return null;

  return createPortal(
    <div className={`actionFeedbackToast actionFeedbackToast-${feedback.tone || "success"}`} role="status" aria-live="polite" key={feedback.key}>
      <span aria-hidden="true">{feedback.tone === "error" ? "!" : "✓"}</span>
      <strong>{feedback.message}</strong>
    </div>,
    document.body,
  );
}
