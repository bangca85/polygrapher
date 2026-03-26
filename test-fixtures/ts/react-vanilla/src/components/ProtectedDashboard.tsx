import { withAuth } from '../hoc/withAuth';

function DashboardInner() {
  return <div>Protected Dashboard</div>;
}

export default withAuth(DashboardInner);
