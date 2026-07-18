import { CashFlowWorkspace } from "@/components/cash-flow-workspace";

export default function CashInAccountPage({ params }: { params: { id: string } }) {
  return <CashFlowWorkspace flow="cash-in" accountId={params.id} />;
}
