import fs from 'node:fs/promises';
import {createKnowledgeSourceLegacyFixture} from '../tests/knowledge-source-legacy-fixture';

// This is an explicit old-version fixture producer, not the final Step32 desktop acceptance.
// All records are committed by the actual fixed Step31 EXE. No source/generation or successful journal is synthesized.
const fixture=await createKnowledgeSourceLegacyFixture();
try{
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/knowledge-source-legacy-fixture.json',JSON.stringify({...fixture.evidence,retained:true},null,2));
  console.log(JSON.stringify({receipt:'test-results/knowledge-source-legacy-fixture.json',temp:fixture.temp,user:fixture.user,workspaceId:fixture.seeded.entry.id,modelHttpRequests:fixture.probe.requests.length,retained:true}));
}finally{await fixture.cleanup()}
