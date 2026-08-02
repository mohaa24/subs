import { BankingWorkspace } from "@/components/banking-workspace";

export default function BankingAccountPage({ params }: { params: { id: string } }) { return <BankingWorkspace accountId={params.id} />; }
