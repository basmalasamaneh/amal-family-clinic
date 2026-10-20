// Deliberately no imports of app.ts, auth, logger, operational tables, or database.
import { contract, validate, assertValid } from "../../../../lib/api-spec/validate-contract.mjs";

const clone = value => structuredClone(value);
const routes = Object.entries(contract.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method,operation]) => ({
    path, method:method.toUpperCase(), operation,
    pattern:new RegExp(`^${path.replaceAll(/\{[^}]+\}/g,"([^/]+)")}$`),
  }))
).sort((a,b)=>(a.path.includes("{")?1:0)-(b.path.includes("{")?1:0));
const codes = {400:["VALIDATION","error.validation"],401:["UNAUTHORIZED","error.unauthorized"],403:["FORBIDDEN","error.forbidden"],404:["NOT_FOUND","error.notFound"],409:["CONFLICT","error.conflict"],423:["PIN_LOCKED","error.pinLocked"],429:["RATE_LIMITED","error.rateLimited"],500:["INTERNAL","error.internal"]};
export function failure(status, code, messageKey, params = {}) {
  const pair=codes[status] ?? codes[500];
  return {status,body:{code:code??pair[0],messageKey:messageKey??pair[1],params}};
}
export const mockOperations = routes;

/** Pure deterministic dispatcher: a mock request is never a real authorization decision. */
export function dispatchMock({method="GET",url="/api/healthz",headers={},body}) {
  const parsed = new URL(url,"http://mock.invalid");
  const pathname=parsed.pathname.replace(/^\/api(?=\/)/,"");
  const route = routes.find(item=>item.method===method.toUpperCase() && item.pattern.test(pathname));
  if(!route)return failure(404);
  const {operation}=route;
  const h=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]));
  const scenario=h["x-mock-scenario"]??"success";
  const role=h["x-mock-role"]??"doctor";
  const consent=h["x-mock-consent"]??"basic";
  const mode=h["x-mock-clinic-mode"]??"network";
  const scenarios={validation:400,unauthorized:401,forbidden:403,missing:404,conflict:409,locked:423,"rate-limit":429,internal:500};
  if (Object.hasOwn(scenarios,scenario)) {
    const status=scenarios[scenario];
    return failure(status,undefined,undefined,status===423||status===429?{retryAfterSeconds:900}:{});
  }
  if(!["success","clinical","withdrawn","reviewed","reauth-required","csrf","duplicate","rejected","no-conflict"].includes(scenario))return failure(400);
  if(!["admin","doctor","front-desk"].includes(role))return failure(403);
  if(!["none","basic","clinical","withdrawn"].includes(consent)||!["network","lite"].includes(mode))return failure(400);
  if(!operation["x-roles"].includes(role))return failure(403);
  // Mirror real entry-point separation, even if fixture metadata is changed.
  if(operation.operationId==="login"&&role==="front-desk")return failure(403);
  if(operation.operationId==="loginPin"&&role!=="front-desk")return failure(403);
  if(scenario==="reauth-required")return failure(403,"REAUTH_REQUIRED","error.reauthRequired");
  if(scenario==="csrf")return failure(403,"CSRF","error.csrf");
  const match=pathname.match(route.pattern);
  const pathNames=[...route.path.matchAll(/\{(\w+)\}/g)].map(x=>x[1]);
  const params=Object.fromEntries(pathNames.map((name,i)=>[name,match[i+1]]));
  for(const p of operation.parameters??[]) {
    // Security is simulated, not authenticated. Domain path/query/body are validated.
    if(p.in==="header")continue;
    let value=p.in==="path"?params[p.name]:parsed.searchParams.get(p.name);
    if(value===null||value===undefined) { if(p.required)return failure(400); else continue; }
    if(p.schema.type==="integer"||p.schema.type==="number")value=Number(value);
    if(!validate(p.schema,value).valid)return failure(400);
  }
  if(operation.requestBody) {
    if(!validate(operation.requestBody.content["application/json"].schema,body).valid)return failure(400);
  } else if(body!==undefined) return failure(400);
  if(body?.clinicId!==undefined&&body.clinicId!==101)return failure(403);
  if(parsed.searchParams.has("clinicId")&&parsed.searchParams.get("clinicId")!=="101")return failure(403);
  if(body?.startsAt&&body?.endsAt&&Date.parse(body.endsAt)<=Date.parse(body.startsAt))return failure(400);
  if(operation.operationId==="mapImport"&&body.decisions.some(d=>d.decision==="link"&&!d.patientId))return failure(400);
  if(operation.operationId==="resolveSync"&&body.decision==="reschedule"&&!body.slot)return failure(400);
  if(operation.operationId==="commitImport"&&scenario!=="reviewed")return failure(409,"REVIEW_REQUIRED","error.reviewRequired",{pendingRows:24});
  const [status,response]=Object.entries(operation.responses).find(([s])=>Number(s)<300);
  const media=response.content?.["application/json"];
  if(!media)return {status:Number(status)};
  let result=clone(media.example);
  const id=operation.operationId;
  if(["login","loginPin","getMe","reauthenticatePin"].includes(id)) {
    const selected=id==="loginPin"||id==="reauthenticatePin"?"front-desk":role;
    result.role=selected;
    result.email=`${selected}@example.invalid`;
    result.doctorId=selected==="doctor"?201:null;
    result.id={admin:903,doctor:901,"front-desk":902}[selected];
    if(selected==="front-desk") {
      result.device={id:1001,clinicId:101};
      result.session={expiresAt:"2026-09-09T15:00:00Z",absoluteExpiresAt:"2026-09-09T15:00:00Z",idleTimeoutSeconds:null};
      result.reauth={required:false,validUntil:"2026-09-09T07:05:00Z"};
    }
  }
  if(id==="withdrawConsent"||scenario==="withdrawn"&&id==="recordPatientConsent") result={...result,level:"none",status:"withdrawn"};
  if(id==="lookupNetwork"||id==="getPatient") {
    const clinical=role==="doctor"&&!["none","withdrawn"].includes(consent)&&scenario!=="withdrawn"&&(consent==="clinical"||scenario==="clinical");
    let patient=clone(contract.paths["/patients/{id}"].get.responses[200].content["application/json"].example);
    if(role==="doctor"&&!["none","withdrawn"].includes(consent)&&scenario!=="withdrawn")patient={...patient,visits:[{clinicId:101,doctorId:201,seenAt:"2026-09-09T07:00:00Z"}]};
    if(clinical)patient={...patient,visibility:"clinical",visits:[{clinicId:101,doctorId:201,seenAt:"2026-09-09T07:00:00Z",complaint:"Dizziness (synthetic)",keyAlerts:["Synthetic medication alert"]}]};
    if(id==="lookupNetwork")result={items:mode==="lite"||["none","withdrawn"].includes(consent)||scenario==="withdrawn"?[]:[patient],nextCursor:null};
    else result=patient;
  }
  if(id==="checkAppointments"&&scenario==="no-conflict")result={ok:true,conflicts:[]};
  if(id==="pushSync")result={outcomes:body.operations.map((o,i)=>{
    const outcome=["duplicate","rejected"].includes(scenario)?scenario:["applied","duplicate","conflict"][i%3];
    return {clientOpId:o.clientOpId,outcome,...(outcome==="rejected"?{error:failure(400).body}:outcome==="conflict"?{conflictId:601}:{entityId:401})};
  }),cursor:"demo:1"};
  if(id==="mapImport")result.rows=result.rows.map(row=>{
    const decision=body.decisions.find(d=>d.rowId===row.rowId);
    return decision?{...row,status:decision.decision==="skip"?"skipped":"approved",linkedPatientId:decision.decision==="link"?decision.patientId:null}:row;
  });
  if(id==="recordPatientConsent")result={...result,level:body.level,...(body.guardian?{guardian:body.guardian}:{})};
  if(id==="mergePatients")result={sourceId:body.sourceId,targetId:body.targetId,decision:body.decision==="merge"?"merged":"not-a-match",simulated:true};
  if(id==="createAppointment") {
    const {overrideReason,holdToken,...values}=body;
    result={...result,...values};
  }
  if(id==="updateAppointment") {
    const {expectedVersion,overrideReason,holdToken,cancelReason,...changes}=body;
    result={...result,...changes,id:Number(params.id),version:expectedVersion+1};
  }
  if(id==="createPatient")result={...result,name:body.name,dateOfBirth:body.dateOfBirth,phone:body.phone};
  if(id==="createClinic"||id==="updateClinic")result={...result,...body};
  if(id==="enrollDevice")result={id:1001,...body};
  if(["getClinic","updateClinic","getPatient","mapImport","commitImport"].includes(id))result.id=Number(params.id);
  if(id==="listPatientConsent")result.items=result.items.map(c=>({...c,patientId:Number(params.id)}));
  if(id==="recordPatientConsent")result.patientId=Number(params.id);
  if(id==="withdrawConsent")result.id=Number(params.id);
  if(id==="getKpis")result.range=parsed.searchParams.get("range");
  assertValid(media.schema,result,`Mock ${id}`);
  return {status:Number(status),body:result};
}
