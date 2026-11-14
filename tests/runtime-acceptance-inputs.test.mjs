import {it,expect} from 'vitest';
import {runtimeAcceptanceInputs} from '../scripts/runtime-acceptance-inputs.mjs';
const env={CBIM_R_MODE:'candidate',CBIM_R_CANDIDATE:'runtime-c0.1.17-r2-candidate',CBIM_R_SOURCE:'a'.repeat(40),CBIM_R_DIGEST:'b'.repeat(64)};
it.each(['candidate','online'])('pins the actual C 0.1.17 installer and R2 in %s mode',mode=>{
  expect(runtimeAcceptanceInputs({...env,CBIM_R_MODE:mode})).toEqual({mode,tag:env.CBIM_R_CANDIDATE,source:env.CBIM_R_SOURCE,expected:env.CBIM_R_DIGEST,coldVersion:'0.1.17',resourceVersion:2,coldTag:'desktop-v0.1.17',installerName:'CBIM-Setup-0.1.17-x64.exe'});
});
it.each(['candidate','online'])('pins the verified C 0.1.18 installer and R2 in %s mode',mode=>{
  const tag='runtime-c0.1.18-r2-candidate';
  expect(runtimeAcceptanceInputs({...env,CBIM_R_MODE:mode,CBIM_R_CANDIDATE:tag})).toEqual({mode,tag,source:env.CBIM_R_SOURCE,expected:env.CBIM_R_DIGEST,coldVersion:'0.1.18',resourceVersion:2,coldTag:'desktop-v0.1.18',installerName:'CBIM-Setup-0.1.18-x64.exe'});
});
it('retains the verified C 0.1.15 path and allows a distinct retry candidate without overwriting',()=>{
  expect(runtimeAcceptanceInputs({...env,CBIM_R_CANDIDATE:'runtime-c0.1.15-r4-candidate-2'})).toMatchObject({coldVersion:'0.1.15',resourceVersion:4,coldTag:'desktop-v0.1.15'});
  expect(runtimeAcceptanceInputs({...env,CBIM_R_CANDIDATE:'runtime-c0.1.17-r2-candidate-10'}).resourceVersion).toBe(2);
});
it.each(['runtime-c0.1.19-r2-candidate','runtime-c0.1.17-r1-candidate','runtime-c0.1.17-r02-candidate','runtime-c0.1.17-r2-candidate-1','runtime-c0.1.17-r999999999999999999-candidate','https://example.com/pkg','../runtime-c0.1.17-r2-candidate'])('rejects unverified or ambiguous target %s',tag=>{
  expect(()=>runtimeAcceptanceInputs({...env,CBIM_R_CANDIDATE:tag})).toThrow();
});
it.each([{CBIM_R_MODE:'unsigned'},{CBIM_R_SOURCE:'main'},{CBIM_R_DIGEST:'bad'},{CBIM_R_CANDIDATE:undefined}])('rejects invalid frozen input %j',change=>expect(()=>runtimeAcceptanceInputs({...env,...change})).toThrow());
