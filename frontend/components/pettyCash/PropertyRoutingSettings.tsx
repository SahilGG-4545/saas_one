'use client';
import { useEffect, useState } from 'react';
import { pcFetch, pcJson, type Context } from './workflowTypes';
interface Candidate { id: string; full_name: string; email: string }
export default function PropertyRoutingSettings({ context, onSaved }: { context: Context; onSaved: () => void }) {
    const [property, setProperty] = useState(context.configuration_properties[0]?.id || '');
    const [users, setUsers] = useState<Candidate[]>([]);
    const [allocator, setAllocator] = useState(''); const [approver, setApprover] = useState('');
    const [search, setSearch] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!property) return; let active = true; setUsers([]); setAllocator(''); setApprover(''); setMessage('');
        Promise.all([pcFetch<{ users: Candidate[] }>(`/api/petty-cash/candidates?org_id=${context.organization_id}&property_id=${property}`), pcFetch<{ assignments: { property_id: string; kind: string; user_id: string; is_primary: boolean }[] }>(`/api/petty-cash/assignments?org_id=${context.organization_id}`)]).then(([candidates, config]) => { if (!active) return; setUsers(candidates.users); setAllocator(config.assignments.find(r => r.property_id === property && r.kind === 'allocator' && r.is_primary)?.user_id || ''); setApprover(config.assignments.find(r => r.property_id === property && r.kind === 'approver' && r.is_primary)?.user_id || ''); }).catch(e => { if (active) setMessage(e.message); });
        return () => { active = false; };
    }, [property, context.organization_id]);
    const matches = users.filter(u => `${u.full_name} ${u.email}`.toLowerCase().includes(search.toLowerCase()) || u.id === allocator || u.id === approver);
    return <form className="space-y-4 max-w-2xl" onSubmit={async event => { event.preventDefault(); setBusy(true); setMessage(''); try { await pcFetch('/api/petty-cash/assignments', pcJson({ organization_id: context.organization_id, property_id: property, allocator_id: allocator, approver_id: approver }, 'PUT')); setMessage('Routing saved. New requests will use these users; reassign pending requests explicitly.'); onSaved(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Save failed'); } finally { setBusy(false); } }}>
        <h2 className="text-lg font-bold">Property Routing</h2><p>Configure the users who allocate and approve petty cash. Requesters cannot choose them.</p>
        <label className="block">Property<select className="pc-input" value={property} onChange={e => setProperty(e.target.value)}>{context.configuration_properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <input className="pc-input" aria-label="Find routing user" placeholder="Search users by name or email" value={search} onChange={e => setSearch(e.target.value)} />
        <label className="block">Allocator<select className="pc-input" required aria-label="Allocator" value={allocator} onChange={e => setAllocator(e.target.value)}><option value="">Select allocator</option>{matches.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.email})</option>)}</select></label>
        <label className="block">Approver<select className="pc-input" required aria-label="Approver" value={approver} onChange={e => setApprover(e.target.value)}><option value="">Select approver</option>{matches.filter(u => u.id !== allocator).map(u => <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.email})</option>)}</select></label>
        <button className="pc-button" disabled={busy || !allocator || !approver || allocator === approver}>{busy ? 'Saving…' : 'Save routing'}</button>{message && <p role="status">{message}</p>}
    </form>;
}
