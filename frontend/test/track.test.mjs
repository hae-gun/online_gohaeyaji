// Usage statistics helpers (src/net/track.js): where people came from, and the beacon address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, beaconUrlFor } from '../src/net/track.js';

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130';

test('source: utm first, then in-app browsers, then the referrer host, else direct', () => {
  assert.equal(sourceOf('', UA_PC, '?utm_source=Insta-Reel'), 'instareel');
  assert.equal(sourceOf('', 'Mozilla/5.0 (iPhone) Instagram 300.0', ''), 'instagram');
  assert.equal(sourceOf('', 'Mozilla/5.0 KAKAOTALK 10.0', ''), 'kakao');
  assert.equal(sourceOf('https://www.google.com/', UA_PC, ''), 'google');
  assert.equal(sourceOf('https://t.co/abc', UA_PC, ''), 'x');
  assert.equal(sourceOf('https://somewhere.example/', UA_PC, ''), 'other');
  assert.equal(sourceOf('', UA_PC, ''), 'direct');
});

test('beacon address follows the realtime server', () => {
  assert.equal(beaconUrlFor('wss://api.gohaeyaji.com/ws'), 'https://api.gohaeyaji.com/api/track');
  assert.equal(beaconUrlFor('ws://localhost:8080/ws'), 'http://localhost:8080/api/track');
  assert.equal(beaconUrlFor(undefined), null);
});
