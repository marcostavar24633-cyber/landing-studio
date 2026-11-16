import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require=createRequire(import.meta.url);
const generateLanding=require("../server/generate-landing-core.js");

test("landing generation uses Cloudflare Workers AI without an OpenAI key",async()=>{
  let requestedModel="";
  const fakeLanding={niche:"кофейня",title:"Кофейня рядом",researchSources:[],assumptions:[]};
  const result=await generateLanding({niche:"кофейня",tier:"premium"},{
    AI:{run:async(model,input)=>{requestedModel=model;assert.match(input.messages[1].content,/JSON SCHEMA/);return {response:JSON.stringify(fakeLanding)}}}
  });
  assert.equal(result.status,200);
  assert.equal(result.body.landing.aiProvider,"cloudflare-workers-ai");
  assert.equal(result.body.landing.tier,"premium");
  assert.equal(requestedModel,"@cf/meta/llama-3.3-70b-instruct-fp8-fast");
});

test("Workers AI errors do not silently fall back to a paid provider",async()=>{
  const result=await generateLanding({niche:"кофейня"},{
    AI:{run:async()=>{throw new Error("quota exhausted")}},
    OPENAI_API_KEY:"must-not-be-used"
  });
  assert.equal(result.status,502);
  assert.match(result.body.error,/Облачная модель/);
});

test("reference analyzer exposes all three analysis modes and request protections",()=>{
  const source=readFileSync(new URL("../functions/api/analyze-reference.js",import.meta.url),"utf8");
  for(const mode of ["structure","composition","detailed"])assert.match(source,new RegExp(mode));
  assert.match(source,/redirect:"manual"/);
  assert.match(source,/MAX_HTML/);
  assert.match(source,/env\.AI\.run/);
  assert.match(source,/https:/);
});
