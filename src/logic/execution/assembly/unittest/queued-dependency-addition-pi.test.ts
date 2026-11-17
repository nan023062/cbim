import {it} from 'vitest';
import {verifyRecursiveDependency} from './support/recursive-dependency-fixture';
it.each(["complete","prepare-stop","submitted-stop","reply-lost"])('preserves explicit addition inputs and original recursive call evidence (%s)',async mode=>{await verifyRecursiveDependency('addition',mode)},120000);
