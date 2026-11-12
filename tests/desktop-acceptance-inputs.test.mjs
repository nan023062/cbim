import {describe, expect, it} from 'vitest';
import {acceptanceInputs, acceptanceTransferExpectation} from '../scripts/desktop-acceptance-inputs.mjs';

const env = {CBIM_ACCEPTANCE_VERSION: '0.1.3', CBIM_ACCEPTANCE_PREVIOUS_VERSION: '0.1.2', CBIM_ACCEPTANCE_COMMIT: 'a'.repeat(40), CBIM_ACCEPTANCE_SHA256: 'b'.repeat(64), CBIM_ACCEPTANCE_MODE: 'candidate'};

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
    expect(()=>acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.12',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.11'})).toThrow();
  });
  it.each(['candidate', 'online'])('uses the unchanged automatic updater from the actual 0.1.4 release in %s mode', mode => {
    expect(acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION:'0.1.5', CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.4', CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.5',previousVersion:'0.1.4',previousUpdateFlow:'automatic',mode});
    expect(()=>acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.4',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.4'})).toThrow();
  });
  it.each(['candidate','online'])('uses the verified 0.1.5 automatic update flow in %s mode',mode=>{
    expect(acceptanceInputs({...env,CBIM_ACCEPTANCE_VERSION:'0.1.6',CBIM_ACCEPTANCE_PREVIOUS_VERSION:'0.1.5',CBIM_ACCEPTANCE_MODE:mode})).toMatchObject({version:'0.1.6',previousVersion:'0.1.5',previousUpdateFlow:'automatic',mode});
  });
  it.each([undefined, '', '0.1.0', '0.1.3', '0.1.2-beta'])('rejects an absent, unsupported or same-version previous UI: %s', previous => {
    expect(() => acceptanceInputs({...env, CBIM_ACCEPTANCE_PREVIOUS_VERSION: previous})).toThrow();
  });
  it.each(['0.1.2', '0.1.1', '0.0.9', '0.1.3-beta', '1.0.0', '0.01.3'])('rejects same, lower, or unsupported targets: %s', version => {
    expect(() => acceptanceInputs({...env, CBIM_ACCEPTANCE_VERSION: version})).toThrow();
  });
  it.each([{CBIM_ACCEPTANCE_COMMIT: 'short'}, {CBIM_ACCEPTANCE_SHA256: 'bad'}, {CBIM_ACCEPTANCE_MODE: 'signed'}])('rejects invalid artifact identity and mode: %j', changes => {
    expect(() => acceptanceInputs({...env, ...changes})).toThrow();
  });
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
