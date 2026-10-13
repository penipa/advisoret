import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FunctionsClient } from '@supabase/functions-js';
import { materializeOverturePlace } from '../../../src/lib/overture/materialize.ts';

const externalId = '0A1B2C3D-4E5F-6789-ABCD-EF0123456789';
const venueId = '123e4567-e89b-12d3-a456-426614174000';

function mockInvoke(implementation) {
  const originalInvoke = FunctionsClient.prototype.invoke;
  FunctionsClient.prototype.invoke = implementation;
  return () => {
    FunctionsClient.prototype.invoke = originalInvoke;
  };
}

test('envía el payload correcto y normaliza external_id', async () => {
  let received;
  const restore = mockInvoke(async (functionName, options) => {
    received = { functionName, options };
    return { data: { venue_id: venueId }, error: null };
  });

  try {
    assert.equal(
      await materializeOverturePlace(`  ${externalId}  `, '  2026/09/23.1  '),
      venueId,
    );
    assert.deepEqual(received, {
      functionName: 'materialize-overture-place',
      options: {
        body: {
          external_id: externalId.toLowerCase(),
          release: '2026/09/23.1',
        },
      },
    });
  } finally {
    restore();
  }
});

test('rechaza external_id inválido sin invocar backend', async () => {
  let invoked = false;
  const restore = mockInvoke(async () => {
    invoked = true;
    return { data: { venue_id: venueId }, error: null };
  });

  try {
    await assert.rejects(
      materializeOverturePlace('not-a-uuid', '2026/09/23.1'),
      /canonical lowercase UUID/,
    );
    assert.equal(invoked, false);
  } finally {
    restore();
  }
});

test('rechaza release vacío sin invocar backend', async () => {
  let invoked = false;
  const restore = mockInvoke(async () => {
    invoked = true;
    return { data: { venue_id: venueId }, error: null };
  });

  try {
    await assert.rejects(
      materializeOverturePlace(externalId, '   '),
      /release must not be empty/,
    );
    assert.equal(invoked, false);
  } finally {
    restore();
  }
});

test('propaga el error de invoke como Error', async () => {
  const restore = mockInvoke(async () => ({
    data: null,
    error: { message: 'unauthorized' },
  }));

  try {
    await assert.rejects(materializeOverturePlace(externalId, '2026/09/23.1'), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'unauthorized');
      return true;
    });
  } finally {
    restore();
  }
});

test('rechaza venue_id inválido en la respuesta', async () => {
  const restore = mockInvoke(async () => ({
    data: { venue_id: 'not-a-uuid' },
    error: null,
  }));

  try {
    await assert.rejects(
      materializeOverturePlace(externalId, '2026/09/23.1'),
      /invalid venue_id/,
    );
  } finally {
    restore();
  }
});
