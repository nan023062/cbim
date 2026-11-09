import path from 'node:path';
import {it,expect} from 'vitest';
import {updateUserRoot} from '../src/backend/updater/restart-profile';
it('keeps ordinary defaults and the original explicit environment',()=>{expect(updateUserRoot([],undefined)).toBeUndefined();const root=path.resolve('test profile');expect(updateUserRoot([],root)).toBe(root)});
it('restores the original profile when Windows Shell loses or replaces the environment',()=>{const root=path.resolve('test profile'),other=path.resolve('other');expect(updateUserRoot(['--updated',`--cbim-user-data-root=${root}${path.sep}.`],other)).toBe(root)});
it('refuses ambiguous or invalid restarts instead of opening the default profile',()=>{const root=path.resolve('test');for(const args of [[`--cbim-user-data-root=${root}`],['--updated','--cbim-user-data-root=relative'],['--updated','--cbim-user-data-root='],['--updated',`--cbim-user-data-root=${root}`,`--cbim-user-data-root=${root}`]])expect(()=>updateUserRoot(args,undefined)).toThrow();for(const root of ['relative',path.resolve('bad"quote'),'x'.repeat(701)])expect(()=>updateUserRoot([],root)).toThrow()});
