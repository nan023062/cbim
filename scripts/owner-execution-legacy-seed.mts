import {createOwnerExecutionLegacyFixture} from '../tests/owner-execution-legacy-fixture';

// Explicitly generate the retained pre-owner sample with fixed Step32 EXE. This is not Step33 desktop acceptance.
const sample=await createOwnerExecutionLegacyFixture();
try{console.log(JSON.stringify({evidence:'test-results/owner-execution-legacy-fixture.json',temp:sample.temp,workspaceId:sample.workspaceId,requestCounts:sample.evidence.requestCounts,killedTestPid:sample.evidence.killedPid,retained:true}))}
finally{await sample.cleanup()}
