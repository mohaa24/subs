import { Suspense } from "react";
import { PayablesWorkspace } from "@/components/payables-workspace";

export default function PayableDetailPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={null}>
      <PayablesWorkspace accountId={params.id} />
    </Suspense>
  );
}
