"use client";

import { useEffect } from "react";

export function reportPrintTitle(reportName: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const name = reportName.replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${name} ${part("day")}.${part("month")}.${part("year")}`;
}

// Browser Save as PDF uses the document title as its suggested filename.
// Update before printing too, for tabs left open across midnight.
export function useReportPrintTitle(reportName: string | null) {
  useEffect(() => {
    if (!reportName) return;
    const previousTitle = document.title;
    const updateTitle = () => { document.title = reportPrintTitle(reportName); };
    updateTitle();
    window.addEventListener("beforeprint", updateTitle);
    return () => {
      window.removeEventListener("beforeprint", updateTitle);
      document.title = previousTitle;
    };
  }, [reportName]);
}
