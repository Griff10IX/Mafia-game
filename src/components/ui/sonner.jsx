import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"
import { sendToastEvent } from "../../utils/api";

const DEFAULT_TOAST_OPTIONS = {
  style: { color: 'var(--noir-toast-foreground, var(--noir-foreground, #f5f5f5))' },
  classNames: {
    toast:
      "group toast app-toast group-[.toaster]:bg-background group-[.toaster]:border-border group-[.toaster]:shadow-lg",
    description: "group-[.toast]:text-muted-foreground",
    actionButton:
      "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
    cancelButton:
      "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
  },
};

const Toaster = ({
  toastOptions: toastOptionsProp,
  ...props
}) => {
  const { theme = "system" } = useTheme()

  const toastOptions = toastOptionsProp
    ? {
        ...DEFAULT_TOAST_OPTIONS,
        ...toastOptionsProp,
        style: { ...DEFAULT_TOAST_OPTIONS.style, ...toastOptionsProp.style },
        classNames: { ...DEFAULT_TOAST_OPTIONS.classNames, ...toastOptionsProp.classNames },
      }
    : DEFAULT_TOAST_OPTIONS;

  return (
    <Sonner
      theme={theme}
      className="toaster app-toaster group"
      toastOptions={toastOptions}
      {...props} />
  );
}

let _toastObservabilityInitialized = false;
let _lastToastAt = 0;
let _lastToastSignature = "";

function normalizeToastText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function sanitizeToastPayload(payload) {
  const p = payload || {};
  const message = normalizeToastText(p.message).slice(0, 500);
  const description = normalizeToastText(p.description).slice(0, 1000);
  const routePath = (typeof window !== "undefined"
    ? `${window.location.pathname || ""}${window.location.search || ""}`
    : ""
  ).slice(0, 500);
  const toastType = String(p.toastType || "default").toLowerCase().slice(0, 32);
  return {
    toast_type: toastType || "default",
    message,
    description: description || null,
    route_path: routePath || null,
    duration_ms: Number.isFinite(Number(p.durationMs)) ? Number(p.durationMs) : null,
    client_created_at: new Date().toISOString(),
    metadata: p.metadata && typeof p.metadata === "object" ? p.metadata : null,
  };
}

function shouldSuppressDuplicate(payload) {
  const sig = `${payload.toast_type}|${payload.message}|${payload.description || ""}|${payload.route_path || ""}`;
  const now = Date.now();
  // Prevent accidental double logs from strict/dev double-run or duplicate invocations.
  if (_lastToastSignature === sig && (now - _lastToastAt) < 250) return true;
  _lastToastSignature = sig;
  _lastToastAt = now;
  return false;
}

function captureToast(kind, messageLike, optionsMaybe) {
  const options = optionsMaybe && typeof optionsMaybe === "object" ? optionsMaybe : {};
  const payload = sanitizeToastPayload({
    toastType: kind,
    message: messageLike,
    description: options.description,
    durationMs: options.duration,
  });
  if (!payload.message && !payload.description) return;
  if (shouldSuppressDuplicate(payload)) return;
  sendToastEvent(payload);
}

export function initToastObservability() {
  if (_toastObservabilityInitialized) return;
  _toastObservabilityInitialized = true;

  const patch = (method, kind) => {
    const original = typeof toast[method] === "function" ? toast[method].bind(toast) : null;
    if (!original) return;
    toast[method] = (...args) => {
      try {
        captureToast(kind, args[0], args[1]);
      } catch (_) {}
      return original(...args);
    };
  };

  patch("success", "success");
  patch("error", "error");
  patch("info", "info");
  patch("warning", "warning");
  patch("message", "message");
  patch("loading", "loading");
}

export { Toaster, toast }
