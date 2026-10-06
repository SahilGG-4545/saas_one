import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../backend/lib/whatsapp/assistant/runtime.ts',import.meta.url),'utf8');
const request={phone:'919000000000',userId:'u1',propertyId:'p1',title:'Water is leaking',mediaUrl:'https://expired.aisensy.com/photo',messageId:'wamid',requestId:'operation-id',interpreter:true};
const hash=value=>createHash('sha256').update(JSON.stringify([value.userId,value.propertyId,value.title,value.mediaUrl || null])).digest('hex');
function harness(booking=null) {
    let markerFailure=true,calls=0;
    const row={id:'ticket-1',wa_assistant_input_hash:hash(request),wa_assistant_completed:false,photo_before_url:'https://storage.example.com/stored.jpg'};
    const admin={from(table){let updating=false;const query={select(){return query;},update(){updating=true;return query;},eq(){return query;},async maybeSingle(){return {data:table==='meeting_room_bookings'?booking:row,error:null};},then(resolve){
        if(updating&&markerFailure){markerFailure=false;return Promise.resolve(resolve({error:new Error('marker unavailable')}));}
        if(updating)row.wa_assistant_completed=true;return Promise.resolve(resolve({error:null}));
    }};return query;}};
    const imports={'node:crypto':{randomUUID,createHash},'@/backend/lib/supabase/admin':{supabaseAdmin:admin},
        '@/backend/lib/whatsapp/processMessage':{processIncomingMessage:async(...args)=>{calls++;assert.equal(args[9],'wamid');assert.equal(args[10].skipTaskRouting,true);assert.equal(args[10].interpreterInputHash,hash(request));return {id:row.id};}},
        '@/backend/services/AiSensyService':{},'@/backend/services/NotificationService':{},'@/backend/utils/timezone':{},'./access':{},'./engine.mjs':{},'./worker.mjs':{},
        '../interpreter/coordinator.mjs':{},'../interpreter/interpret.mjs':{},'../interpreter/delivery.mjs':{},'../interpreter/context':{},'@/task-manager/TaskDatabaseService':{},
        '../interpreter/booking-credits.mjs':{},
        '../interpreter/media.mjs':{fetchPhoto:()=>assert.fail('stored attachment must not be downloaded from expired source')},sharp:()=>assert.fail('no new image download')};
    const exports={};const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(compiled+'\nexports.testDependencies = dependencies;',{exports,require:name=>{if(!(name in imports))throw new Error(name);return imports[name];},process:{env:{}},console,Date,Buffer});
    return {create:exports.testDependencies.createTicket,dependencies:exports.testDependencies,row,get calls(){return calls;}};
}
test('ticket retry resumes stored attachment after marker failure without downloading expired provider URL',async()=>{
    const h=harness();await assert.rejects(h.create(request),/marker unavailable/);
    assert.equal(h.row.wa_assistant_completed,false);
    assert.equal((await h.create(request)).id,'ticket-1');assert.equal(h.row.wa_assistant_completed,true);
    await h.create(request);assert.equal(h.calls,2);
});

test('completed ticket recovery matches the immutable reviewed input hash',async()=>{
    const h=harness();h.row.wa_assistant_completed=true;
    assert.equal((await h.dependencies.findTicket('operation-id','u1',request)).id,'ticket-1');
    assert.equal(await h.dependencies.findTicket('operation-id','u1',{...request,title:'New issue'}),null);
});
test('booking retry recognizes the original interval and cannot repurpose its request ID',async()=>{
    const h=harness({id:'booking-1',property_id:'p1',meeting_room_id:'r1',booking_date:'2026-10-06',start_time:'14:30:00',end_time:'15:00:00'});
    const booking={userId:'u1',propertyId:'p1',roomId:'r1',date:'2026-10-06',startTime:'14:30',endTime:'15:00',requestId:'operation-id',interpreter:true};
    assert.equal((await h.dependencies.bookRange(booking)).id,'booking-1');
    await assert.rejects(h.dependencies.bookRange({...booking,startTime:'15:00',endTime:'16:00'}),error=>error.code==='OPERATION_ALREADY_CREATED');
    assert.equal(h.calls,0);
});
test('committed request cannot be reused with a corrected property, issue or photo',async()=>{
    const h=harness();
    for(const change of [{propertyId:'p2'},{title:'New issue'},{mediaUrl:null},{mediaUrl:'https://other/photo'}]) {
        await assert.rejects(h.create({...request,...change}),error=>error.code==='OPERATION_ALREADY_CREATED');
    }
    assert.equal(h.calls,0);assert.equal(h.row.wa_assistant_completed,false);
});
