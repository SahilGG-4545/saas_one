import test from 'node:test';
import assert from 'node:assert/strict';
import { drainPhone } from '../backend/lib/whatsapp/assistant/worker.mjs';
import { advanceConversation } from '../backend/lib/whatsapp/interpreter/coordinator.mjs';
test('failed dynamic delivery reuses persisted interpretation rather than invoking Groq or booking again',async()=>{
    let calls=0,state=null,ready=false,complete=false,claimCount=0;
    const event={id:'operation-id',payload:{phone:'919000000000',text:'Book Meeting Room',messageId:'wamid'},snapshot:null,reply:null,status:'pending'};
    const deps={now:()=>new Date(),findUser:async()=>({id:'user'}),properties:async()=>[{id:'property',name:'Office',organization_id:'org'}],
        settings:async()=>({enabled:true,bookingEnabled:true,ticketEnabled:true,pilotUserIds:['user'],defaultDate:'ask'}),rooms:async()=>[],interpret:()=>assert.fail('menu does not need Groq')};
    const store={claim:async()=>complete||claimCount++>2?null:{token:'token',event},save:async(_,value,reply)=>{state=value;event.reply=reply;event.status='ready';ready=true;},
        finish:async(_,error)=>{if(!error)complete=true;},fail:()=>assert.fail('transient failure not permanent')};
    const advance=async(...args)=>{calls++;return advanceConversation(...args);};
    await drainPhone('919000000000',{store,advance,dependencies:deps,send:async()=>({success:false,retryable:true})});
    assert.equal(ready,true);assert.equal(state.active,'booking');
    await drainPhone('919000000000',{store,advance,dependencies:deps,send:async()=>({success:true,messageIds:['response-id']})});
    assert.equal(calls,1);assert.equal(complete,true);
});
