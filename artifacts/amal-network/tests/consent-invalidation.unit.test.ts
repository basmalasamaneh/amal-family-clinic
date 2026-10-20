import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinicalDataBlocked, invalidateClinicalData, completeClinicalInvalidation } from '../src/network/consent-invalidation';

test('protected reads stay blocked until every consent operation is reconciled', () => {
  assert.equal(clinicalDataBlocked(), false);
  const first = invalidateClinicalData();
  const second = invalidateClinicalData();
  assert.notEqual(first, second);
  assert.equal(clinicalDataBlocked(), true);
  completeClinicalInvalidation(first);
  assert.equal(clinicalDataBlocked(), true);
  completeClinicalInvalidation('unrelated');
  assert.equal(clinicalDataBlocked(), true);
  completeClinicalInvalidation(second);
  assert.equal(clinicalDataBlocked(), false);
});
