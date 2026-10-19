import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contract, validateContract, assertValid } from "../../../lib/api-spec/validate-contract.mjs";
import { dispatchMock, mockOperations } from "../src/mock/engine.mjs";
import { createMockServer } from "../src/mock/server.mjs";
import * as generated from "../../../lib/api-zod/src/generated/api.ts";

function requestFor(route, headers={}) {
  let path=route.path.replaceAll("{id}","301");
  const search=new URLSearchParams();
  for(const p of route.operation.parameters??[])if(p.in==="query"&&p.required)search.set(p.name,String(p.example));
  if(search.size)path+=`?${search}`;
  return {method:route.method,url:`/api${path}`,body:structuredClone(route.operation.requestBody?.content["application/json"].example),headers:{
    "x-mock-role":route.operation["x-roles"][0],
    ...(route.operation.operationId==="commitImport"?{"x-mock-scenario":"reviewed"}:{}),...headers,
  }};
}
function assertResponse(route, response) {
  const schema=route.operation.responses[response.status]?.content?.["application/json"]?.schema;
  assert.ok(route.operation.responses[response.status],`${route.operation.operationId}: undocumented status ${response.status}`);
  if(schema)assertValid(schema,response.body,route.operation.operationId);
  else assert.equal(response.body,undefined);
}
test("OpenAPI validates and retains Api/health/base URL; Section 12 operation set complete",async()=>{
  const validated=await validateContract();
  assert.equal(validated.operations,36);
  assert.ok(validated.examples>=380);
  assert.equal(contract.info.title,"Api");
  assert.equal(contract.servers[0].url,"/api");
  assert.equal(contract.paths["/healthz"].get.operationId,"healthCheck");
  const required={
    "/auth/login":["post"],"/auth/pin":["post"],"/auth/logout":["post"],"/me":["get"],
    "/clinics":["get","post"],"/clinics/{id}":["get","patch"],"/doctors":["get"],
    "/appointments":["get","post"],"/appointments/{id}":["patch"],"/appointments/check":["post"],
    "/patients":["get","post"],"/patients/{id}":["get"],"/network/lookup":["get"],
    "/patients/{id}/consent":["get","post"],"/consent/{id}/withdraw":["post"],
    "/sync/push":["post"],"/sync/pull":["get"],"/sync/conflicts":["get"],"/sync/resolve":["post"],
    "/import/upload":["post"],"/import/{id}/map":["post"],"/import/{id}/commit":["post"],
    "/kpis":["get"],"/audit":["get"],"/network/health":["get"],
    "/patients/duplicates":["get"],"/patients/merge":["post"],
  };
  for(const [path,methods] of Object.entries(required))for(const method of methods)assert.ok(contract.paths[path]?.[method]);
});
for(const route of mockOperations) {
  test(`${route.method} ${route.path}: deterministic, schema-valid success and generated Zod`,()=>{
    const request=requestFor(route);
    const response=dispatchMock(request);
    assert.ok(response.status<300,`${JSON.stringify(response)}`);
    assert.deepEqual(response,dispatchMock(request));
    assertResponse(route,response);
    const prefix=route.operation.operationId[0].toUpperCase()+route.operation.operationId.slice(1);
    if(request.body!==undefined) {
      assert.ok(generated[`${prefix}Body`],`Missing ${prefix}Body`);
      assert.equal(generated[`${prefix}Body`].safeParse(request.body).success,true);
    }
    if(response.body!==undefined) {
      const parsed=generated[`${prefix}Response`].safeParse(response.body);
      assert.equal(parsed.success,true,parsed.success?"":parsed.error.message);
    }
  });
  test(`${route.operation.operationId}: all documented error examples and role matrix`,()=>{
    for(const [scenario,status] of Object.entries({validation:400,unauthorized:401,forbidden:403,missing:404,conflict:409,locked:423,"rate-limit":429,internal:500})) {
      const response=dispatchMock(requestFor(route,{"x-mock-scenario":scenario}));
      assert.equal(response.status,status);
      assertResponse(route,response);
      assert.deepEqual(Object.keys(response.body).sort(),["code","messageKey","params"]);
    }
    for(const role of ["admin","doctor","front-desk","unrecognized"]) {
      const response=dispatchMock(requestFor(route,{"x-mock-role":role}));
      assert.equal(response.status<300,route.operation["x-roles"].includes(role),`${role} ${route.operation.operationId}`);
      assertResponse(route,response);
    }
  });
}
test("clinical consent does not leak history to reception or administrator",()=>{
  const lookup=mockOperations.find(r=>r.operation.operationId==="lookupNetwork");
  for(const role of ["doctor","front-desk","admin"])for(const consent of ["none","basic","clinical","withdrawn"])for(const mode of ["network","lite"]) {
    const response=dispatchMock(requestFor(lookup,{"x-mock-role":role,"x-mock-consent":consent,"x-mock-clinic-mode":mode}));
    assertResponse(lookup,response);
    if(role==="admin")assert.equal(response.status,403);
    else if(mode==="lite"||["none","withdrawn"].includes(consent))assert.deepEqual(response.body.items,[]);
    else {
      const patient=response.body.items[0];
      assert.equal("visits" in patient,role==="doctor");
      if(role==="doctor")assert.equal("complaint" in patient.visits[0],consent==="clinical");
      assert.equal(patient.visibility,role==="doctor"&&consent==="clinical"?"clinical":"basic");
      const parsed=generated.LookupNetworkResponse.parse(response.body);
      assert.equal("visits" in parsed.items[0],role==="doctor","Generated Zod must preserve the correct projection");
    }
  }
});
test("all 24 import rows require review; three name suggestions never links; commit blocked until explicit reviewed scenario",()=>{
  const upload=mockOperations.find(r=>r.operation.operationId==="uploadImport");
  const rows=dispatchMock(requestFor(upload)).body.rows;
  assert.equal(rows.length,24);
  assert.equal(rows.filter(r=>r.suggestedPatientIds.length).length,3);
  for(const row of rows) {
    assert.equal(row.reviewRequired,true);
    assert.equal(row.status,"needs-review");
    assert.equal(row.linkedPatientId,null);
  }
  const commit=mockOperations.find(r=>r.operation.operationId==="commitImport");
  const blocked=dispatchMock(requestFor(commit,{"x-mock-scenario":"success"}));
  assert.equal(blocked.status,409);
  assert.equal(blocked.body.code,"REVIEW_REQUIRED");
  assertResponse(commit,blocked);
  const reviewed=dispatchMock(requestFor(commit));
  assert.equal(reviewed.body.skippedRows.length,24);
  assert.equal(reviewed.body.simulated,true);
  assert.deepEqual(reviewed.body.created,[]);
});
test("validation, cross-clinic rejection, leading-zero PIN, and no credential echo",()=>{
  const pin=mockOperations.find(r=>r.operation.operationId==="loginPin");
  const valid=requestFor(pin);
  valid.body.pin="0123";
  const response=dispatchMock(valid);
  assert.equal(response.status,200);
  assert.equal(response.body.role,"front-desk");
  for(const pinValue of ["123",1234,"１２３４"," 0123"])assert.equal(dispatchMock({...valid,body:{...valid.body,pin:pinValue}}).status,400);
  assert.equal(dispatchMock({...valid,body:{...valid.body,role:"admin"}}).status,400);
  assert.ok(!JSON.stringify(response.body).includes("0123"));
  const appointment=mockOperations.find(r=>r.operation.operationId==="createAppointment");
  const cross=requestFor(appointment); cross.body.clinicId=999;
  assert.equal(dispatchMock(cross).status,403);
  assert.equal(dispatchMock({url:"/api/appointments"}).status,400);
  assert.equal(dispatchMock({url:"/api/patients/not-a-number"}).status,400);
});
test("reception cannot bypass trusted-device PIN flow using password login",()=>{
  const password=mockOperations.find(r=>r.operation.operationId==="login");
  const pin=mockOperations.find(r=>r.operation.operationId==="loginPin");
  assert.deepEqual(password.operation["x-roles"],["doctor","admin"]);
  assert.deepEqual(pin.operation["x-roles"],["front-desk"]);
  for(const role of ["doctor","admin","front-desk"]) {
    const request=requestFor(password,{"x-mock-role":role});
    request.body.email=`${role}@example.invalid`;
    const response=dispatchMock(request);
    assert.equal(response.status,role==="front-desk"?403:200);
    assertResponse(password,response);
    const pinResponse=dispatchMock(requestFor(pin,{"x-mock-role":role}));
    assert.equal(pinResponse.status,role==="front-desk"?200:403);
    assertResponse(pin,pinResponse);
    if(pinResponse.status===200) {
      assert.equal(pinResponse.body.role,"front-desk");
      assert.ok(pinResponse.body.device);
      assert.equal(pinResponse.body.session.idleTimeoutSeconds,null);
    }
  }
  const example=pin.operation.responses[200].content["application/json"].example;
  assert.equal(example.role,"front-desk");
  assert.ok(example.device);
});
test("scenarios: withdrawal, conflict-free slots, sync rejected/duplicate and reauth/CSRF",()=>{
  for(const [id,scenario] of [["withdrawConsent","success"],["checkAppointments","no-conflict"],["pushSync","duplicate"],["pushSync","rejected"],["recordPatientConsent","reauth-required"],["recordPatientConsent","csrf"]]) {
    const route=mockOperations.find(r=>r.operation.operationId===id);
    const response=dispatchMock(requestFor(route,{"x-mock-scenario":scenario}));
    assertResponse(route,response);
    if(id==="withdrawConsent")assert.equal(response.body.status,"withdrawn");
    if(id==="checkAppointments")assert.deepEqual(response.body,{ok:true,conflicts:[]});
  }
});
test("mock entry refuses production and missing opt-in; dependency graph has no database/app imports",()=>{
  assert.throws(()=>createMockServer({NODE_ENV:"production",AMAL_MOCK:"1"}),/production/);
  assert.throws(()=>createMockServer({NODE_ENV:"development"}),/AMAL_MOCK/);
  const server=createMockServer({NODE_ENV:"development",AMAL_MOCK:"1",DATABASE_URL:"postgres://unreachable.invalid:1/no_database"});
  assert.equal(server.listening,false);
  server.close();
  for(const path of ["../src/mock/server.mjs","../src/mock/engine.mjs","../../../lib/api-spec/validate-contract.mjs"]) {
    const content=readFileSync(new URL(path,import.meta.url),"utf8");
    const imports=content.split("\n").filter(line=>/^import /.test(line)).join("\n");
    assert.doesNotMatch(imports,/@workspace\/db|drizzle|app\.|auth\/|pg["']/);
  }
  const prior=process.env.DATABASE_URL;
  process.env.DATABASE_URL="postgres://intentionally-unreachable.invalid:1/no_database";
  try { assert.deepEqual(dispatchMock({url:"/api/healthz"}),{status:200,body:{status:"ok"}}); }
  finally { if(prior===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=prior; }
});
