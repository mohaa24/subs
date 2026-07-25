import { Suspense } from "react";
import { ReceivablesWorkspace } from "@/components/receivables-workspace";

export default function ReceivableDetailPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={null}>
      <ReceivablesWorkspace accountId={params.id} />
    </Suspense>
  );
}
