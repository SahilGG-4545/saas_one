'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { pettyCashCaps } from '@/frontend/lib/pettyCash/roles';
export default function PettyCashNavLink() {
    const params = useParams();
    const { membership } = useAuth();
    const org = typeof params?.orgId === 'string' ? params.orgId : membership?.org_id;
    if (!org || !pettyCashCaps(membership, org).canSee) return null;
    return <Link href={`/${org}/petty-cash`} className="flex items-center gap-3 px-4 py-2.5 my-2 rounded-xl font-semibold text-sm text-text-secondary hover:bg-muted hover:text-text-primary"><Wallet className="w-4 h-4 shrink-0" /><span>Petty Cash</span></Link>;
}
