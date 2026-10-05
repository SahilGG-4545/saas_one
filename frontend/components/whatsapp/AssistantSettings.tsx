'use client';
import { useEffect, useState } from 'react';

interface Config { enabled:boolean; bookingEnabled:boolean; ticketEnabled:boolean; defaultDate:'ask'|'today'; pilotUserIds:string[] }
const initial:Config={enabled:false,bookingEnabled:true,ticketEnabled:true,defaultDate:'ask',pilotUserIds:[]};

export default function AssistantSettings({organizationId}:{organizationId:string}) {
    const [config,setConfig]=useState<Config>(initial);
    const [userId,setUserId]=useState('');
    const [users,setUsers]=useState('');
    const [loaded,setLoaded]=useState(false);
    const [status,setStatus]=useState('');
    const [busy,setBusy]=useState(false);
    const [workflow,setWorkflow]=useState<'booking'|'ticket'>('booking');
    const [sample,setSample]=useState('Book conference room 1 tomorrow from 2.30 PM to 3 PM');
    const [preview,setPreview]=useState('');
    const [readiness,setReadiness]=useState<{llm:boolean;projectApi:boolean;globalEnabled:boolean}|null>(null);
    useEffect(()=>{
        const controller=new AbortController();
        setLoaded(false);setStatus('');
        fetch(`/api/whatsapp-assistant/settings?organizationId=${encodeURIComponent(organizationId)}`,{signal:controller.signal})
            .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);
                setConfig(data.config);setUsers(data.config.pilotUserIds.join('\n'));setUserId(data.userId);setReadiness(data.readiness);setLoaded(true);})
            .catch(error=>{if(error.name!=='AbortError')setStatus(error.message);});
        return()=>controller.abort();
    },[organizationId]);
    async function request(method:'PUT'|'POST') {
        setBusy(true);setStatus('');
        try {
            const body=method==='PUT'?{organizationId,config:{...config,pilotUserIds:users.split(/[\s,]+/).filter(Boolean)}}:{organizationId,workflow,text:sample};
            const response=await fetch('/api/whatsapp-assistant/settings',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const data=await response.json();if(!response.ok)throw new Error(data.error);
            if(method==='PUT'){setConfig(data.config);setStatus('WhatsApp AI settings saved.');}
            else setPreview(JSON.stringify(data,null,2));
        } catch(error){setStatus(error instanceof Error?error.message:'Request failed');}
        finally{setBusy(false);}
    }
    return <section className="mt-8 border-t pt-8 space-y-4">
        <h3 className="text-lg font-semibold">WhatsApp AI pilot</h3>
        <p className="text-sm text-slate-600">Users choose Create Ticket or Book Meeting Room from the menu. AI reads their details; the app checks access and asks for confirmation before creating anything.</p>
        {readiness && <p className="text-sm">AI key: {readiness.llm?'ready':'missing'} · Project messaging: {readiness.projectApi?'ready':'missing'} · Global switch: {readiness.globalEnabled?'on':'off'}</p>}
        <fieldset disabled={!loaded||busy} className="space-y-4 disabled:opacity-60">
            {(['enabled','bookingEnabled','ticketEnabled'] as const).map(key=><label key={key} className="flex gap-2 items-center"><input type="checkbox" checked={config[key]} onChange={event=>setConfig({...config,[key]:event.target.checked})}/>{({enabled:'Enable pilot for this organization',bookingEnabled:'Allow meeting-room booking',ticketEnabled:'Allow ticket creation'})[key]}</label>)}
            <label className="block">When the booking date is missing <select className="border rounded ml-2 p-2" value={config.defaultDate} onChange={event=>setConfig({...config,defaultDate:event.target.value as Config['defaultDate']})}><option value="ask">Ask the user</option><option value="today">Use today (shown before confirmation)</option></select></label>
            <label className="block">Pilot user IDs (one per line)<textarea className="block border rounded p-2 w-full mt-2" value={users} rows={3} onChange={event=>setUsers(event.target.value)}/></label>
            <button type="button" className="text-sm underline" onClick={()=>setUsers([...new Set([...users.split(/[\s,]+/).filter(Boolean),userId])].join('\n'))}>Add my account to the pilot</button>
            <div><button type="button" className="bg-primary text-white rounded px-4 py-2" onClick={()=>request('PUT')}>Save AI settings</button></div>
            <h4 className="font-semibold">Try a message without creating anything</h4>
            <select aria-label="Preview workflow" className="border rounded p-2" value={workflow} onChange={event=>setWorkflow(event.target.value as typeof workflow)}><option value="booking">Meeting-room booking</option><option value="ticket">Ticket creation</option></select>
            <textarea aria-label="Sample WhatsApp message" className="block border rounded p-2 w-full" value={sample} rows={2} onChange={event=>setSample(event.target.value)}/>
            <button type="button" className="border rounded px-4 py-2" onClick={()=>request('POST')}>Preview interpretation</button>
        </fieldset>
        {status&&<p role="status" className="text-sm">{status}</p>}
        {preview&&<pre className="bg-slate-50 rounded p-3 text-xs whitespace-pre-wrap">{preview}</pre>}
    </section>;
}
