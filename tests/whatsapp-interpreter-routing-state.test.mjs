import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import * as config from '../backend/lib/whatsapp/interpreter/config.mjs';
const source=await readFile(new URL('../backend/lib/whatsapp/interpreter/context.ts',import.meta.url),'utf8');
function context({task=null,state=null,pending=[],error=null}={}){
    const reads=[];
    const admin={from(table){const query={select(){return query;},eq(field,value){reads.push([table,field,value]);return query;},gt(){return query;},contains(){return query;},in(){return query;},limit(){return query;},
        maybeSingle(){return query;},then(resolve,reject){return Promise.resolve({data:table==='conversation_context'?task:table==='whatsapp_assistant_sessions'?{state}:pending,error}).then(resolve,reject);}};return query;}};
    const imports={'@/backend/lib/supabase/admin':{supabaseAdmin:admin},'../assistant/access':{},'./config.mjs':config};
    const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name],Date,Set,Map,process:{env:{}}});
    return {read:exports.getConversationRoutingState,reads};
}
test('routing reads recipient-scoped state without modifying Task Manager or facility contexts',async()=>{
    const app=context({task:{context_data:{state:'AWAITING_SYSTEM_CHOICE'}},state:{llmVersion:1,active:'booking',drafts:{booking:{expiresAt:Date.now()+60000}}}});
    const result=await app.read('919000000000');assert.equal(result.taskActive,true);assert.equal(result.taskChoicePending,true);assert.equal(result.facilityActive,true);
    assert.deepEqual(app.reads.filter(([_table,field])=>field==='phone'||field==='phone_number').map(([_table,_field,phone])=>phone),['919000000000','919000000000','919000000000']);
});
test('expired facility drafts release task routing but pending pilot events reserve their conversation',async()=>{
    const options={task:{context_data:{}},state:{llmVersion:1,active:'booking',drafts:{booking:{expiresAt:Date.now()-1000}}}};
    assert.equal((await context(options).read('919000000000')).facilityActive,false);
    assert.equal((await context({...options,pending:[{id:'queued-booking-selection'}]}).read('919000000000')).facilityActive,true);
});
test('routing storage errors fail closed instead of guessing which service should execute',async()=>{
    await assert.rejects(context({error:{message:'storage unavailable'}}).read('919000000000'),/Conversation routing unavailable/);
});
