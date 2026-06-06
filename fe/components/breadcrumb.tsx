"use client";

import Link from "next/link";
import { ChevronRight, House } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <div className="mb-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const isHomeItem = item.href === "/" && i === 0;

          const crumbContent = isHomeItem ? (
            <>
              <House className="h-4 w-4 shrink-0" />
              <span className="sr-only">{item.label}</span>
            </>
          ) : (
            item.label
          );

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
                  {crumbContent}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={isHomeItem ? item.label : undefined}
                >
                  {crumbContent}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
