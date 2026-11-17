import {it} from 'vitest';
import {verifyRecursiveDependency} from './support/recursive-dependency-fixture';
it.each(["complete","stop","restart-held"])('preserves explicit replacement inputs and original recursive call evidence (%s)',async mode=>{await verifyRecursiveDependency('replacement',mode)},120000);
