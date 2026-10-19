import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dispatchMock, failure } from "./engine.mjs";

export function createMockServer(env=process.env) {
  if(env.NODE_ENV!=="development"||env.AMAL_MOCK!=="1")throw new Error("Mock requires NODE_ENV=development and AMAL_MOCK=1; production is never supported");
  const allowedOrigin=env.MOCK_FRONTEND_ORIGIN??"http://localhost:5173";
  return createServer(async(req,res)=>{
    res.setHeader("X-Amal-Mock","true");
    res.setHeader("Cache-Control","no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    const send=({status,body})=>{
      res.statusCode=status;
      if(body!==undefined)res.setHeader("Content-Type","application/json");
      res.end(body===undefined?undefined:JSON.stringify(body));
    };
    if(req.headers.origin) {
      if(req.headers.origin!==allowedOrigin)return send(failure(403));
      res.setHeader("Access-Control-Allow-Origin",allowedOrigin);
      res.setHeader("Vary","Origin");
      res.setHeader("Access-Control-Allow-Credentials","true");
      res.setHeader("Access-Control-Allow-Methods","GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers","Content-Type, X-CSRF-Token, X-Mock-Role, X-Mock-Scenario, X-Mock-Consent, X-Mock-Clinic-Mode");
      res.setHeader("Access-Control-Expose-Headers","X-Amal-Mock");
    }
    if(req.method==="OPTIONS")return send({status:204});
    if(req.url==="/docs/openapi.yaml") {
      res.setHeader("Content-Type","application/yaml");
      return res.end(readFileSync(new URL("../../../../lib/api-spec/openapi.yaml",import.meta.url)));
    }
    try {
      let size=0;
      const chunks=[];
      for await(const chunk of req) {
        size+=chunk.length;
        if(size>1048576)return send(failure(400));
        chunks.push(chunk);
      }
      const text=Buffer.concat(chunks).toString("utf8");
      let body;
      if(text) {
        if(!req.headers["content-type"]?.includes("application/json"))return send(failure(400));
        try { body=JSON.parse(text); } catch { return send(failure(400)); }
      }
      send(dispatchMock({method:req.method,url:req.url,headers:req.headers,body}));
    } catch {
      // Never echo request values, credentials, validation internals, or stack traces.
      send(failure(500));
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.MOCK_PORT??4010);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid MOCK_PORT");
  createMockServer().listen(port,"127.0.0.1",()=>console.info(`SIMULATED API only: http://127.0.0.1:${port}/api (no database, no real authentication)`));
}
