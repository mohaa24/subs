"use client";

import { useEffect, useState } from "react";

const ACCOUNTING_PREVIEW_STORAGE_KEY = "subs.accountingPreviewUnlocked";
const ACCOUNTING_PREVIEW_REQUIRED_PRESSES = 5;
const ACCOUNTING_PREVIEW_WINDOW_MS = 3000;

function isAccountingPreviewShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  if (key !== "a") return false;

  return (
    (event.ctrlKey && event.shiftKey) ||
    (event.ctrlKey && event.altKey) ||
    (event.metaKey && event.shiftKey)
  );
}

export function useAccountingPreviewUnlock() {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    setUnlocked(window.localStorage.getItem(ACCOUNTING_PREVIEW_STORAGE_KEY) === "true");

    let pressCount = 0;
    let firstPressAt = 0;

    function handleKeyDown(event: KeyboardEvent) {
      if (!isAccountingPreviewShortcut(event)) return;
      event.preventDefault();

      const now = Date.now();
      if (!firstPressAt || now - firstPressAt > ACCOUNTING_PREVIEW_WINDOW_MS) {
        firstPressAt = now;
        pressCount = 0;
      }

      pressCount += 1;
      if (pressCount >= ACCOUNTING_PREVIEW_REQUIRED_PRESSES) {
        window.localStorage.setItem(ACCOUNTING_PREVIEW_STORAGE_KEY, "true");
        setUnlocked(true);
        pressCount = 0;
        firstPressAt = 0;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return unlocked;
}
