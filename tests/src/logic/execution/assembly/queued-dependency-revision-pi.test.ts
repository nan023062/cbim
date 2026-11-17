import {it} from 'vitest';
import {verifyRecursiveDependency} from './support/recursive-dependency-fixture';
it.each(["complete","bad-output","prepare-stop","submitted-stop"])('preserves explicit revision inputs and original recursive call evidence (%s)',async mode=>{await verifyRecursiveDependency('revision',mode)},120000);
