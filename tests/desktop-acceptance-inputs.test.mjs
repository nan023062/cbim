import {describe, expect, it} from 'vitest';
import {acceptanceInputs, acceptanceTransferExpectation, acceptanceReadyTarget, acceptanceCanAwaitCheckRetry} from '../scripts/desktop-acceptance-inputs.mjs';

const retryCheck={currentVersion:'0.1.15',enabled:true,phase:'idle',error:'暂时无法检查更新，将在下一分钟自动重试，也可手动检查。'};
it.each(['idle','available'])('observes the real automatic check retry from %s without treating it as ready',phase=>{
  expect(acceptanceCanAwaitCheckRetry({...retryCheck,phase},'ready')).toBe(true);
  expect(()=>acceptanceReadyTarget({...retryCheck,phase},'0.1.15','0.1.16')).toThrow();
});
it.each([{error:'下载或校验失败，五分钟后自动重试，也可手动重试下载。'},{error:'unknown'},{error:undefined},{phase:'installing'},{phase:'ready'},{enabled:false},{currentVersion:'0.1.16'}])('does not tolerate unknown or non-check failures: %j',change=>{
  expect(acceptanceCanAwaitCheckRetry({...retryCheck,...change},'ready')).toBe(false);
});
it('does not tolerate a check failure while waiting for installation',()=>expect(acceptanceCanAwaitCheckRetry(retryCheck,'installing')).toBe(false));

const env = {CBIM_ACCEPTANCE_VERSION: '0.1.3', CBIM_ACCEPTANCE_PREVIOUS_VERSION: '0.1.2', CBIM_ACCEPTANCE_COMMIT: 'a'.repeat(40), CBIM_ACCEPTANCE_SHA256: 'b'.repeat(64), CBIM_ACCEPTANCE_MODE: 'candidate'};

const resourceReady = () => ({currentVersion:'0.1.15',currentResourceVersion:1,phase:'ready',release:{version:'0.1.15',resourceVersion:4,delivery:'resources',tag:'runtime-c0.1.15'}});
it('requires the verified public R4 hop before treating a newer cold installer as ready',()=>{
  expect(acceptanceReadyTarget(resourceReady(),'0.1.15','0.1.16')).toEqual({kind:'resources',resourceVersion:4});
  expect(acceptanceReadyTarget({...resourceReady(),currentResourceVersion:4,release:{version:'0.1.16',delivery:'installer'}},'0.1.15','0.1.16')).toEqual({kind:'installer'});
  expect(acceptanceReadyTarget({currentVersion:'0.1.14',phase:'ready',release:{version:'0.1.16'}},'0.1.14','0.1.16')).toEqual({kind:'installer'});
});
it.each([
  {phase:'downloading'}, {error:'failed'}, {currentVersion:'0.1.14'}, {currentResourceVersion:4}, {currentResourceVersion:undefined},
  {release:{...resourceReady().release,version:'0.1.16'}}, {release:{...resourceReady().release,tag:'other'}},
  {release:{...resourceReady().release,resourceVersion:5}}, {release:{version:'0.1.15'}}, {release:{version:'0.1.16',delivery:'other'}},
])('rejects stale, unverified, or wrong ready targets: %j',change=>{
  expect(()=>acceptanceReadyTarget({...resourceReady(),...change},'0.1.15','0.1.16')).toThrow();
});

it('keeps differential mandatory unless the separate online fallback diagnosis is explicitly selected', () => {
  expect(acceptanceTransferExpectation({}, {mode:'online', previousUpdateFlow:'prefetch'})).toBe('differential');
  expect(acceptanceTransferExpectation({CBIM_ACCEPTANCE_TRANSFER:'full-fallback'}, {mode:'online', previousUpdateFlow:'prefetch'})).toBe('full-fallback');
  expect(() => acceptanceTransferExpectation({CBIM_ACCEPTANCE_TRANSFER:'any'}, {mode:'online', previousUpdateFlow:'prefetch'})).toThrow();
  expect(() => acceptanceTransferExpectation({CBIM_ACCEPTANCE_TRANSFER:'full-fallback'}, {mode:'candidate', previousUpdateFlow:'prefetch'})).toThrow();
  expect(() => acceptanceTransferExpectation({CBIM_ACCEPTANCE_TRANSFER:'full-fallback'}, {mode:'online', previousUpdateFlow:'automatic'})).toThrow();
});
describe('desktop upgrade acceptance inputs', () => {
  it.each(['candidate', 'online'])('pins the actual previous release in %s mode', mode => {
    expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_MODE: mode})).toEqual({version: '0.1.3', previousVersion: '0.1.2', previousUpdateFlow: 'two-step', commit: env.CBIM_ACCEPTANCE_COMMIT, expected: env.CBIM_ACCEPTANCE_SHA256, mode});
  });
  it.each(['candidate', 'online'])('uses the actual automatic updater for 0.1.3 in %s mode', mode => {
    expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.4', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.3', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.4',previousVersion:'0.1.3',previousUpdateFlow:'automatic',mode});
  });
  it('preserves the earlier two-step flow and rejects unsupported future previous versions', () => {
    expect(acceptanceInputs({...env,CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.1'}).previousUpdateFlow).toBe('two-step');
    expect(()=>acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.17',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.16'})).toThrow();
  });
  it.each(['candidate', 'online'])('uses the unchanged automatic updater from the actual 0.1.4 release in %s mode', mode => {
    expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.5', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.4', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.5',previousVersion:'0.1.4',previousUpdateFlow:'automatic',mode});
    expect(()=>acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.4',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.4'})).toThrow();
  });
  it.each(['candidate','online'])('uses the verified 0.1.5 automatic update flow in %s mode',mode=>{
    expect(acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.6',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.5',CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.6',previousVersion:'0.1.5',previousUpdateFlow:'automatic',mode});
  });
  it.each([undefined, '', '0.0.9', '0.1.3', '0.1.2-beta'])('rejects an absent, unsupported or same-version previous UI: %s', previous => {
    expect(() => acceptanceInputs({...env, CBIM_ACCEPTANCE_PREVIOUS_VERSION: previous})).toThrow();
  });
  it.each(['0.1.2', '0.1.1', '0.0.9', '0.1.3-beta', '1.0.0', '0.01.3'])('rejects same, lower, or unsupported targets: %s', version => {
    expect(() => acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION: version})).toThrow();
  });
  it.each([{CBIM_ACCEPTANCE_COMMIT: 'short'}, {CBIM_ACCEPTANCE_SHA256: 'bad'}, {CBIM_ACCEPTANCE_MODE: 'signed'}])('rejects invalid artifact identity and mode: %j', changes => {
    expect(() => acceptanceInputs({...env, ...changes})).toThrow();
  });
});

it.each(['candidate','online'])('accepts explicitly selected 0.1.0 with its original settings-page two-step update in %s mode',mode=>{
  expect(acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.15',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.0',CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.15',previousVersion:'0.1.0',previousUpdateFlow:'two-step',mode});
  expect(()=>acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.0',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.0',CBIM_ACCEPTANCE_MODE:mode})).toThrow();
});

it.each(['candidate', 'online'])('recognizes unchanged B prefetch UI for a newer cache repair in %s mode', mode => {
  expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.12', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.11', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.12',previousVersion:'0.1.11',previousUpdateFlow:'prefetch',mode});
});

it.each(['candidate', 'online'])('accepts the released cache repair 0.1.12 as the actual previous prefetch client in %s mode', mode => {
  expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.13', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.12', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.13',previousVersion:'0.1.12',previousUpdateFlow:'prefetch',mode});
});

it.each(['candidate', 'online'])('accepts the verified 0.1.13 prefetch client for the conversation repair in %s mode', mode => {
  expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.14', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.13', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.14',previousVersion:'0.1.13',previousUpdateFlow:'prefetch',mode});
  expect(() => acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.13', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.13', CBIM_ACCEPTANCE_MODE:mode})).toThrow();
});

it.each(['candidate','online'])('accepts the actual 0.1.14 client for the first runtime migration in %s mode',mode=>{expect(acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.15',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.14',CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({previousVersion:'0.1.14',previousUpdateFlow:'prefetch',mode})});
it.each(['candidate','online'])('pins the released 0.1.15 cold client for a newer installer in %s mode',mode=>{
  expect(acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.16',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.15',CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.16',previousVersion:'0.1.15',previousUpdateFlow:'prefetch',mode});
  expect(()=>acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.15',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.15',CBIM_ACCEPTANCE_MODE:mode})).toThrow();
});
it.each(['candidate','online'])('supports actual 0.1.6 automatic updater in %s mode',mode=>{expect(acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.7',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.6',CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({previousVersion:'0.1.6',previousUpdateFlow:'automatic',mode})});
it.each(['candidate','online'])('supports the unchanged 0.1.7 updater for the aligned 0.1.8 candidate in %s mode',mode=>{expect(acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.8',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.7',CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.8',previousVersion:'0.1.7',previousUpdateFlow:'automatic',mode})});

it.each(['candidate','online'])('supports the released 0.1.8 automatic updater in %s mode', mode => {
  expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.9', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.8', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.9', previousVersion:'0.1.8', previousUpdateFlow:'automatic', mode});
  expect(() => acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.8', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.8'})).toThrow();
});

it.each(['candidate','online'])('accepts 0.1.9 to A with the original automatic installation flow in %s mode', mode => {
  expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.10', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.9', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({previousUpdateFlow:'automatic', mode});
});
it.each(['candidate','online'])('accepts A to B as background prefetch with explicit installation in %s mode', mode => {
  expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.11', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.10', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({previousUpdateFlow:'prefetch', mode});
});
