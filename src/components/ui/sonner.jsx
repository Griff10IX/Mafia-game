import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

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

export { Toaster, toast }
