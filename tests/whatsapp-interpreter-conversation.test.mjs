import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceConversation } from '../backend/lib/whatsapp/interpreter/coordinator.mjs';

const fields = value => ({ property:null,room:null,date:null,start:null,end:null,issue:null,...value });
function harness(extra={}) {
    const calls=[];
    const deps={
        now:()=>new Date('2026-10-05T06:00:00Z'),
        findUser:async()=>({id:'u1'}),
        properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'}],
        settings:async()=>({enabled:true,bookingEnabled:true,ticketEnabled:true,defaultDate:'ask',pilotUserIds:['u1']}),
        rooms:async()=>[{id:'r1',name:'Conference Room 1'},{id:'r2',name:'Conference Room 2'}],
        availableRooms:async()=>[{id:'r1',name:'Conference Room 1'}],
        creditSummary:async()=>'1 hours required; 2 hours remaining',
        interpret:async()=>({ok:true,intent:'details',fields:fields({room:'conference room 1',date:'today',start:'2.30pm',end:'3 pm'})}),
        findBooking:async()=>null,findTicket:async()=>null,
        bookRange:async value=>{calls.push(['book',value]);return {id:'booking-1'};},
        createTicket:async value=>{calls.push(['ticket',value]);return {id:'ticket-1'};},
        ...extra,
    };
    let state=null;
    return {calls,deps,get state(){return state;},async send(text,other={}){
        const result=await advanceConversation({phone:'919000000000',messageId:'wamid',requestId:`event-${Math.random()}`,text,mediaType:'text',...other},state,deps);
        state=result.session;return result;
    }};
}

test('menu booking collects grounded details, decimal clocks, and requires confirmation',async()=>{
    const h=harness();
    assert.equal((await h.send('hi')).reply.key,'menu');
    await h.send('Book Meeting Room');
    const prepared=await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    assert.match(prepared.reply.text,/14:30.*15:00/);
    assert.equal(h.calls.length,0);
    const requestId=h.state.drafts.booking.id;
    await h.send('confirm booking');
    assert.equal(h.calls.length,1);
    assert.equal(h.calls[0][1].requestId,requestId);
    assert.equal(h.calls[0][1].startTime,'14:30');
    assert.equal(h.state.drafts.booking,undefined);
    await h.send('confirm booking');
    assert.equal(h.calls.length,1);
});
test('all-user mode works for booking and tickets but excludes other organizations and disabled services',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'private',name:'Private Office',organization_id:'o2'}],
        settings:async org=>({enabled:true,accessMode:org==='o1'?'all':'selected',pilotUserIds:[],bookingEnabled:true,ticketEnabled:false,defaultDate:'ask'})});
    const booking=await h.send('Book Meeting Room');
    assert.equal(h.state.active,'booking');
    assert.equal(h.state.drafts.booking.propertyId,'p1');
    assert.doesNotMatch(booking.reply.text,/Private Office/);
    assert.match((await h.send('Create Ticket')).reply.text,/not enabled/);
    h.deps.settings=async()=>({enabled:true,accessMode:'all',pilotUserIds:[],bookingEnabled:true,ticketEnabled:true,defaultDate:'ask'});
    await h.send('Create Ticket');
    assert.equal(h.state.active,'ticket');
    h.deps.properties=async()=>[];
    await h.send('Submit Ticket');
    assert.equal(h.calls.length,0);
});

test('no menu selection, task commands, invalid model output and injected fields cannot create tickets',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'invented issue'})})});
    await h.send('done all');
    await h.send('lights not working');
    assert.equal(h.state.active,null);
    await h.send('Create Ticket');
    await h.send('lights not working');
    await h.send('submit ticket');
    assert.equal(h.calls.length,0);
});
test('all-user mode creates through the existing services only after explicit confirmation and can be restricted again',async()=>{
    const h=harness({settings:async()=>({enabled:true,accessMode:'all',pilotUserIds:[],bookingEnabled:true,ticketEnabled:true,defaultDate:'ask'})});
    await h.send('Book Meeting Room');await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    assert.equal(h.calls.length,0);await h.send('Confirm Booking');assert.equal(h.calls[0][0],'book');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({issue:'Water is leaking'})});
    await h.send('Create Ticket');await h.send('Water is leaking');
    assert.equal(h.calls.length,1);await h.send('Submit Ticket');assert.equal(h.calls[1][0],'ticket');
    await h.send('Book Meeting Room');
    h.deps.settings=async()=>({enabled:true,accessMode:'selected',pilotUserIds:[],bookingEnabled:true,ticketEnabled:true,defaultDate:'ask'});
    await h.send('Confirm Booking');assert.equal(h.calls.length,2);assert.equal(h.state.drafts.booking,undefined);
});

test('ticket photos optional; selected ticket does not delegate to Task Manager',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Floor lights are not working'})})});
    await h.send('Create Ticket');
    const result=await h.send('Floor lights are not working');
    assert.match(result.reply.text,/Submit Ticket/);
    await h.send('Submit Ticket');
    assert.equal(h.calls[0][0],'ticket');
    assert.equal(h.calls[0][1].mediaUrl,null);
});

test('fresh access revocation blocks confirmation and rendering draft details',async()=>{
    const h=harness();
    await h.send('Book Meeting Room');
    await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    h.deps.properties=async()=>[];
    const result=await h.send('confirm booking');
    assert.equal(h.calls.length,0);
    assert.doesNotMatch(result.reply.text,/Conference Room/);
});

test('switching workflows preserves separate drafts; unknown and stale quotes never execute',async()=>{
    const h=harness({quote:async()=>null});
    await h.send('Book Meeting Room');
    await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    const original=h.state.drafts.booking.id;
    await h.send('Create Ticket');
    assert.equal(h.state.drafts.booking.id,original);
    const unknown=await h.send('yes',{quotedIds:['other-user-message']});
    assert.match(unknown.reply.text,/cannot link/i);
    assert.equal(h.calls.length,0);
    h.deps.quote=async()=>({workflow:'booking',conversation_id:original,revision:0});
    const stale=await h.send('confirm booking',{quotedIds:['old-review']});
    assert.match(stale.reply.text,/older|latest/i);
    assert.equal(h.calls.length,0);
});

test('partial request retains time and asks for missing date and room; ambiguous AM/PM stays missing',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({start:'3 pm',end:'4 pm'})})});
    await h.send('Book Meeting Room');
    const answer=await h.send('book for 3 pm to 4 pm');
    assert.match(answer.reply.text,/date/i);
    assert.match(answer.reply.text,/room/i);
    assert.equal(h.state.drafts.booking.fields.start,'3 pm');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({start:'3',end:'4'})});
    const ambiguous=await h.send('instead 3 to 4');
    assert.match(ambiguous.reply.text,/AM\/PM/);
    assert.equal(h.calls.length,0);
});

test('multiple properties require a scoped choice; unknown property is not silently substituted',async()=>{
    const h=harness({properties:async()=>[{id:'p1',name:'SS Plaza',organization_id:'o1'},{id:'p2',name:'Other Office',organization_id:'o1'}],interpret:async()=>({ok:true,intent:'details',fields:fields({property:'Private Building'})})});
    await h.send('Book Meeting Room');
    const denied=await h.send('Book in Private Building');
    assert.match(denied.reply.text,/property/i);
    assert.equal(h.state.drafts.booking.propertyId,undefined);
    await h.send('1');
    assert.equal(h.state.drafts.booking.propertyId,'p1');
    assert.equal(h.calls.length,0);
});

test('task notification and bare yes cannot confirm a booking or consume numbered property choices',async()=>{
    const h=harness({hasTaskContext:async()=>true});
    await h.send('Book Meeting Room');
    await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    const original=structuredClone(h.state.drafts.booking.fields);
    await h.send('yes');
    await h.send('I completed the inspection task at 3 pm');
    assert.deepEqual(h.state.drafts.booking.fields,original);
    assert.equal(h.calls.length,0);
    await h.send('Confirm Booking');
    assert.equal(h.calls.length,1);
});

test('menu button can start collection if provider has not returned campaign message IDs',async()=>{
    const h=harness({quote:async()=>null});
    await h.send('Book Meeting Room',{quotedIds:['unmapped-menu']});
    assert.equal(h.state.active,'booking');
    assert.equal(h.calls.length,0);
});

test('correction invalidates prior review and unavailable room or insufficient credits never reports success',async()=>{
    const h=harness();
    await h.send('Book Meeting Room');
    await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    h.deps.interpret=async()=>({ok:true,intent:'details',fields:fields({start:'4 pm',end:'5 pm'})});
    await h.send('instead 4 pm to 5 pm');
    h.deps.availableRooms=async()=>[];
    const unavailable=await h.send('Confirm Booking');
    assert.match(unavailable.reply.text,/unavailable/);assert.equal(h.calls.length,0);
    h.deps.availableRooms=async()=>[{id:'r1'}];
    h.deps.bookRange=async()=>{throw Object.assign(new Error('credits'),{code:'INSUFFICIENT_CREDITS'});};
    await h.send('Confirm Booking'); // refresh review after availability changed
    const failure=await h.send('Confirm Booking');
    assert.match(failure.reply.text,/credits/);
    assert.ok(h.state.drafts.booking);
});

test('captioned photo is grounded ticket evidence; bare photo asks for issue and retains attachment',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Water is leaking'})})});
    await h.send('Create Ticket');
    const bare=await h.send('',{mediaType:'image',mediaUrl:'https://example.com/photo.jpg'});
    assert.match(bare.reply.text,/issue/);
    await h.send('Water is leaking',{mediaType:'image',mediaUrl:'https://example.com/photo.jpg'});
    await h.send('Submit Ticket');
    assert.equal(h.calls[0][1].mediaUrl,'https://example.com/photo.jpg');
});

test('completed operation is recovered after worker crash without recreating resource',async()=>{
    const h=harness({findBooking:async()=>({id:'already-created'})});
    await h.send('Book Meeting Room');
    await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    h.deps.availableRooms=async()=>[];
    await h.send('Confirm Booking');
    assert.equal(h.calls.length,0);assert.equal(h.state.active,null);
});

test('expired draft and changed account cannot be confirmed',async()=>{
    const h=harness();
    await h.send('Book Meeting Room');
    await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    h.deps.now=()=>new Date('2026-10-05T07:00:00Z');
    await h.send('Confirm Booking');
    assert.equal(h.calls.length,0);
    h.deps.findUser=async()=>({id:'u2'});
    const switched=await h.send('Confirm Booking');
    assert.equal(switched.session,null);
});

test('relative date midnight and singleton room replacement require a new review',async()=>{
    const h=harness({now:()=>new Date('2026-10-05T18:25:00Z'),settings:async()=>({enabled:true,bookingEnabled:true,ticketEnabled:true,pilotUserIds:['u1'],defaultDate:'today'}),rooms:async()=>[{id:'r1',name:'Room A'}],interpret:async()=>({ok:true,intent:'details',fields:fields({start:'11.58pm',end:'11.59pm'})})});
    await h.send('Book Meeting Room');
    await h.send('book 11.58pm to 11.59pm');
    const revision=h.state.drafts.booking.revision;
    h.deps.now=()=>new Date('2026-10-05T18:31:00Z');
    const midnight=await h.send('Confirm Booking');
    assert.match(midnight.reply.text,/2026-10-06/);assert.equal(h.calls.length,0);
    assert.ok(h.state.drafts.booking.revision>revision);
    h.deps.rooms=async()=>[{id:'r2',name:'Room B'}];h.deps.availableRooms=async()=>[{id:'r2'}];
    const replaced=await h.send('Confirm Booking');
    assert.match(replaced.reply.text,/Room B/);assert.equal(h.calls.length,0);
});

test('failed photo-caption interpretation cannot change a reviewed ticket',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Water is leaking'})})});
    await h.send('Create Ticket');await h.send('Water is leaking');
    const original=structuredClone(h.state.drafts.ticket);
    h.deps.interpret=async()=>({ok:false,reason:'provider_error'});
    await h.send('unknown caption',{mediaType:'image',mediaUrl:'https://example.com/new.jpg'});
    assert.equal(h.state.drafts.ticket.mediaUrl,undefined);
    assert.deepEqual(h.state.drafts.ticket.review,original.review);
    await h.send('Submit Ticket');assert.equal(h.calls[0][1].mediaUrl,null);
});

test('committed booking is recovered even if its time and draft expiry have passed',async()=>{
    const h=harness();await h.send('Book Meeting Room');await h.send('Book conference room 1 today from 2.30pm to 3 pm');
    h.deps.now=()=>new Date('2026-10-05T10:00:00Z');
    h.deps.findBooking=async()=>({id:'stored',property_id:'p1'});
    const result=await h.send('Confirm Booking');assert.equal(result.reply,null);assert.equal(h.calls.length,0);
});

test('blocked media fails before ticket creation and user can remove photo and submit normally',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:'Water is leaking'})})});
    await h.send('Create Ticket');await h.send('Water is leaking',{mediaType:'image',mediaUrl:'https://example.com/photo'});
    h.deps.createTicket=async()=>{throw Object.assign(new Error('blocked photo'),{code:'INVALID_MEDIA'});};
    const blocked=await h.send('Submit Ticket');assert.match(blocked.reply.text,/No Photo/);assert.equal(h.calls.length,0);
    await h.send('No Photo');assert.equal(h.state.drafts.ticket.mediaUrl,undefined);
    h.deps.createTicket=async value=>{h.calls.push(['ticket',value]);return {id:'ticket-1'};};
    await h.send('Submit Ticket');assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].mediaUrl,null);
});

test('duplicate room names use the displayed backend ID and do not change with list ordering',async()=>{
    const h=harness({rooms:async()=>[{id:'r1',name:'Conference Room'},{id:'r2',name:'Conference Room'}],availableRooms:async()=>[{id:'r2'}],interpret:async()=>({ok:true,intent:'details',fields:fields({date:'tomorrow',start:'3 pm',end:'4 pm'})})});
    await h.send('Book Meeting Room');await h.send('tomorrow 3 pm to 4 pm');
    h.deps.rooms=async()=>[{id:'r2',name:'Conference Room'},{id:'r1',name:'Conference Room'}];
    await h.send('2');await h.send('Confirm Booking');
    assert.equal(h.calls[0][1].roomId,'r2');
});

test('completed ticket recovery uses the same trimmed issue as original creation',async()=>{
    const h=harness({interpret:async()=>({ok:true,intent:'details',fields:fields({issue:' Water is leaking '})})});
    await h.send('Create Ticket');await h.send('Water is leaking');
    h.deps.now=()=>new Date('2026-10-05T07:00:00Z');
    h.deps.findTicket=async(_id,_user,expected)=>{assert.equal(expected.title,'Water is leaking');return {id:'stored',property_id:'p1'};};
    const result=await h.send('Submit Ticket');assert.equal(result.reply,null);assert.equal(h.calls.length,0);
});
