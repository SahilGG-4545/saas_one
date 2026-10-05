import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DashboardLayout from '../../../app/(dashboard)/layout';
import { usePathname } from './navigation';
function Fixture() {
    const pathname = usePathname();
    return <DashboardLayout>{pathname.includes('/petty-cash') ? <h1 data-testid="petty-body">Petty Cash fixture body</h1> : <div data-testid="unused-page">Must not mount a second dashboard</div>}</DashboardLayout>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
