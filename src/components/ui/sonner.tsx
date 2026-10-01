"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CheckIcon, InfoIcon, TriangleAlertIcon, Loader2Icon } from "lucide-react";

/**
 * Toasts (Part 1 §3): ink card, cream text, bottom right; the coloured
 * hard shadow carries the tone — marigold for success, red for errors,
 * grey for neutral. 4s hold (errors 8s), up to 3 stacked.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={(resolvedTheme ?? "light") as ToasterProps["theme"]}
      position="bottom-right"
      visibleToasts={3}
      duration={4000}
      className="toaster group"
      icons={{
        success: (
          <span className="grid size-[18px] place-items-center rounded-full bg-[#2f9e5f] text-white">
            <CheckIcon className="size-[11px] stroke-[3]" />
          </span>
        ),
        info: <InfoIcon className="text-primary size-4" />,
        warning: <TriangleAlertIcon className="text-primary size-4" />,
        error: (
          <span className="grid size-[18px] place-items-center rounded-full bg-[#c8372d] text-[12px] font-extrabold text-white">
            !
          </span>
        ),
        loading: <Loader2Icon className="text-primary size-4 animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "cn-toast group/toast flex w-[var(--width)] items-center gap-3 rounded-sm px-4 py-3 text-sm bg-[#2b2118] text-[#fffaf1] shadow-[3px_3px_0_#9a8c7a] dark:bg-[#f3ebdf] dark:text-[#1c1713] data-[type=success]:shadow-[3px_3px_0_#f2b233] data-[type=error]:shadow-[3px_3px_0_#c8372d]",
          title: "font-bold",
          description: "text-[13px] opacity-80",
          content: "flex-1 min-w-0 flex flex-col gap-0.5",
          icon: "shrink-0 flex items-center",
          actionButton:
            "shrink-0 rounded-[5px] bg-[#f2b233] px-3 py-1.5 text-[13px] font-bold text-[#2b2118]",
          cancelButton:
            "shrink-0 rounded-[5px] px-2 py-1 text-[13px] font-semibold text-[#9a8c7a]",
          closeButton: "text-[#9a8c7a]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
