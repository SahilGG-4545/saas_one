import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import sharp from 'sharp';
import { loadTs } from './load-ts.mjs';
const user='00000000-0000-0000-0000-000000000011',org='00000000-0000-0000-0000-000000000001',id='00000000-0000-0000-0000-000000000030';
const access={user:{id:user},organizationId:org,canManageRouting:false};
const auth={'@/backend/lib/pettyCash/access':{resolvePettyCashAccess:async()=>access,isPettyCashAccessError:()=>false,readOrgId:()=>org}};
const request=(body)=>new NextRequest('http://fixture/api/petty-cash',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('bulk action accepts only allocation/approval and reports independent failures without deleting anything',async()=>{
 const called=[];const mocks={...auth,'@/backend/lib/pettyCash/api':{pcRequest:async(_a,rid)=>rid===id?{id}:null,isUuid:x=>typeof x==='string'&&x.length===36},'@/backend/lib/pettyCash/actions':{applyPettyCashAction:async(a,rid,action,body)=>{called.push({rid,action,body});return {data:{id:rid},error:null};}}};
 const {POST}=loadTs('app/api/petty-cash/bulk/route.ts',mocks);
 assert.equal((await POST(request({action:'pay',items:[{id}]}))).status,400);
 assert.equal((await POST(request({action:'approve',items:[{id},{id}]}))).status,400);
 const response=await POST(request({action:'allocate',items:[{id,expected_version:0,allocated_amount:10},{id:'00000000-0000-0000-0000-000000000031',expected_version:0}]}));const data=await response.json();assert.equal(data.results[0].ok,true);assert.equal(data.results[1].ok,false);assert.equal(called.length,1);assert.ok(called[0].body.remark.includes('Batch'));
});
test('detail request authorization happens before any proof, expense or activity query',async()=>{
 let reads=0;const mocks={...auth,'@/backend/lib/pettyCash/api':{pcRequest:async()=>null},'@/backend/lib/pettyCash/actions':{},'@/backend/lib/supabase/admin':{supabaseAdmin:{from:()=>{reads++;throw Error('Should not read evidence');}}}};
 const {GET}=loadTs('app/api/petty-cash/[id]/route.ts',mocks);const response=await GET(new NextRequest('http://fixture'),{params:Promise.resolve({id})});assert.equal(response.status,404);assert.equal(reads,0);
});
test('private upload rejects spoofed/oversized files and records owned metadata without a public URL',async()=>{
 let writes=0;const inserted=[];
 const database={storage:{from:()=>({upload:async()=>{writes++;return {error:null};}})},from:()=>({insert:async value=>{inserted.push(value);return {error:null};}})};
 const {POST}=loadTs('app/api/petty-cash/upload/route.ts',{...auth,'@/backend/lib/supabase/admin':{supabaseAdmin:database}});
 const upload=(bytes,type,name='receipt.png')=>{const form=new FormData();form.append('file',new File([bytes],name,{type}));return POST(new NextRequest('http://fixture/upload',{method:'POST',body:form}));};
 assert.equal((await upload('This is not a PDF','application/pdf','invoice.pdf')).status,400);
 assert.equal((await upload('%PDF-1.4\nnot really a PDF\n%%EOF','application/pdf','fake.pdf')).status,400);
 assert.equal((await upload(new Uint8Array(16*1024*1024),'image/png')).status,400);
 const png=await sharp({create:{width:16,height:16,channels:3,background:'white'}}).png().toBuffer();assert.equal((await upload(png,'application/pdf')).status,400);
 const response=await upload(png,'image/png');const data=await response.json();assert.equal(response.status,200);assert.ok(data.upload_id);assert.equal(data.url,undefined);assert.equal(writes,1);assert.equal(inserted[0].uploaded_by,user);assert.ok(inserted[0].storage_path.startsWith(`${org}/${user}/`));
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>'];
 let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 4\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 assert.equal((await upload(pdf,'application/pdf','valid.pdf')).status,200);assert.equal(writes,2);
});
test('tenant and vendor variants are excluded consistently, internal roles and single organization scoping remain allowed',()=>{
 const {pettyCashCaps}=loadTs('frontend/lib/pettyCash/roles.ts');
 for(const role of ['tenant','tenant_user','tenant_admin','super_tenant','vendor','food_vendor','maintenance_vendor','cafeteria_vendor','pantry_vendor','external_vendor'])assert.equal(pettyCashCaps({org_id:org,org_role:role},org).canSee,false,role);
 for(const role of ['mst','staff','hr','hr_head','security','procurement','property_admin','org_admin','org_super_admin','ops_super_admin','accounts','bd_rep','bd_admin'])assert.equal(pettyCashCaps({org_id:org,org_role:role},org).canSee,true,role);
 assert.equal(pettyCashCaps({org_id:org,org_role:'mst'},'other-org').canSee,false);
});
test('detail balance uses cents so fully spent decimal amounts show exact zero',async()=>{
 const data={petty_cash_documents:[],petty_cash_activity:[],petty_cash_expenses:[],petty_cash_wallet_entries:[{kind:'credit',amount:.3},{kind:'debit',amount:.1},{kind:'debit',amount:.2}],petty_cash_settlement_status:null};
 const query=table=>{const q={select:()=>q,eq:()=>q,order:()=>q,maybeSingle:()=>Promise.resolve({data:data[table],error:null}),then:resolve=>Promise.resolve({data:data[table],error:null}).then(resolve)};return q;};
 const {GET}=loadTs('app/api/petty-cash/[id]/route.ts',{...auth,'@/backend/lib/pettyCash/api':{pcRequest:async()=>({id})},'@/backend/lib/pettyCash/actions':{},'@/backend/lib/supabase/admin':{supabaseAdmin:{from:query}}});
 const result=await GET(new NextRequest('http://fixture'),{params:Promise.resolve({id})});assert.equal((await result.json()).balance,0);
});
