import { CashFlowWorkspace } from "@/components/cash-flow-workspace";

export default function CashOutAccountPage({ params }: { params: { id: string } }) {
  return <CashFlowWorkspace flow="cash-out" accountId={params.id} />;
}
