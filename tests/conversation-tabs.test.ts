import {expect,test} from 'vitest';
import {readLayouts} from '../src/frontend/shell/tabs';

test('tab binding persists only valid task IDs and remains workspace scoped',()=>{const id='a'.repeat(64),other='b'.repeat(64);const data=readLayouts(JSON.stringify({[id]:{tabs:[{id:'one',kind:'chat',title:'对话',taskId:'task-1',draft:'草稿'}]},[other]:{tabs:[{id:'two',kind:'chat',title:'对话',taskId:'../other'}]}}));expect(data[id].tabs[0].taskId).toBe('task-1');expect(data[other].tabs[0].taskId).toBeUndefined()});