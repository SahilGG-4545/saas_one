import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';
import { pcError } from '@/backend/lib/pettyCash/api';
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;
    const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);
    const { data, error, count } = await supabaseAdmin.rpc('pc_my_expenses', { actor: access.user.id, org: access.organizationId }, { count: 'exact' }).select('*,request:petty_cash_requests(request_no)').order('created_at', { ascending: false }).range((page - 1) * 50, page * 50 - 1);
    return error ? pcError(error) : NextResponse.json({ expenses: data, total_pages: Math.max(1, Math.ceil((count || 0) / 50)) });
}
