import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCard, evaluateCard, parseCallInput } from '../public/lib.js';

test('bingo card marks called numbers and free space', () => {
  const card = makeCard([[2,17,31,46,63],[3,18,32,48,65],[4,24,null,49,67],[12,26,41,59,68],[13,30,44,60,73]]);
  const result = evaluateCard(card, new Set([2,17,31,46,63]), 'line');
  assert.equal(result.wins.length, 1);
  assert.equal(result.wins[0].name, 'hàng 1');
});

test('call input accepts only 1 through 75', () => {
  assert.equal(parseCallInput(' 42 '), 42);
  assert.equal(parseCallInput('0'), null);
  assert.equal(parseCallInput('76'), null);
});
