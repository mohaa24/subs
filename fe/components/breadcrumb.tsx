"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  const router = useRouter();
  const fallbackHref =
    [...items]
      .slice(0, -1)
      .reverse()
      .find((item) => item.href)?.href ?? "/";

  function handleBack() {
    if (typeof window === "undefined") {
      router.push(fallbackHref);
      return;
    }

    let hasSameOriginReferrer = false;
    if (document.referrer) {
      try {
        hasSameOriginReferrer = new URL(document.referrer).origin === window.location.origin;
      } catch {
        hasSameOriginReferrer = false;
      }
    }

    if (window.history.length > 1 && hasSameOriginReferrer) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {items.length > 1 ? (
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
          <span>Back</span>
        </button>
      ) : null}

      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              )}
              {isLast || !item.href ? (
                <span
                  className={
                    isLast
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  }
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
