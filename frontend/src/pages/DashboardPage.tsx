import { DashboardGrid, type DashboardGridItem } from '@/features/dashboard/DashboardGrid';
import {
  CollectedMonthWidget,
  NetProfitWidget,
  MonthlyNetProfitChart,
  MonthStatusBadgesWidget,
  ClearanceWidget,
} from '@/features/dashboard/widgets';
import { PageContainer, PageHeader } from '@/components/layout';

const defaultLayout: DashboardGridItem[] = [
  { id: 'monthCollected', size: 'sm', content: <CollectedMonthWidget /> },
  { id: 'monthProfit', size: 'sm', content: <NetProfitWidget /> },
  { id: 'monthStatus', size: 'sm', content: <MonthStatusBadgesWidget /> },
  { id: 'profitChart', size: 'full', content: <MonthlyNetProfitChart /> },
  { id: 'clearance', size: 'full', content: <ClearanceWidget /> },
];

export function DashboardPage() {
  return (
    <PageContainer>
      <PageHeader title="Inicio" />
      <DashboardGrid items={defaultLayout} />
    </PageContainer>
  );
}
