import {expect,it} from "vitest";
import {generatorScenario} from "../../test-utils/group-generator-fixtures";
import {generateLocalGroups} from "../use-cases/generate-local-groups";

// Real production scheduling/clock for measurements. Correctness/complexity is
// tested separately with a deterministic clock; no narrow elapsed-time assertion.
it.each([[8,2],[32,8],[64,8],[96,16]])("measures bounded search for %i participants and %i groups",async(teams,groups)=>{
  const s=generatorScenario(teams,groups),result=await generateLocalGroups(s.input,s.repository);
  console.log(JSON.stringify({benchmark:"constraint-groups-v1",teams,groups,state:result.state,...result.stats}));
  expect(["Viable","No determinado"]).toContain(result.state);
  expect(result.stats.nodes).toBeLessThanOrEqual(100_000);expect(result.stats.checks).toBeLessThanOrEqual(2_000_000);
  if(result.state==="Viable")expect(result.groups!.flatMap(g=>g.teamIds)).toHaveLength(teams);
});
