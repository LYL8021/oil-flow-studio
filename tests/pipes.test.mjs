import test from 'node:test';
import assert from 'node:assert/strict';
import { pipePath } from '../dist/pipes.js';

const line = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y2 }];
const count = (text, character) => [...text].filter(value => value === character).length;
const finite = path => assert.doesNotMatch(path, /NaN|Infinity|undefined/);

test('interior perpendicular crossing draws one semicircular bridge', () => {
  const path = pipePath(line(0, 0, 100, 0), [line(50, -50, 50, 50)]);
  assert.equal(count(path, 'C'), 2);
  assert.match(path, /^M0 0L41 0C/);
  assert.match(path, /50 -9C/);
  assert.match(path, /L100 0$/);
  finite(path);
});

test('shared endpoints, T contacts, nearby corners, and parallel lines do not receive bridges', () => {
  for (const other of [line(100, 0, 100, 50), line(50, 0, 50, 50), line(5, -50, 5, 50), line(0, 5, 100, 5)]) {
    assert.equal(pipePath(line(0, 0, 100, 0), [other]), 'M0 0L100 0');
  }
});

test('reversed traversal keeps horizontal humps above and vertical humps right', () => {
  const horizontal = pipePath(line(100, 0, 0, 0), [line(50, -50, 50, 50)]);
  const vertical = pipePath(line(0, 100, 0, 0), [line(-50, 50, 50, 50)]);
  assert.match(horizontal, /^M100 0L59 0C/);
  assert.match(horizontal, /50 -9C/);
  assert.match(vertical, /^M0 100L0 59C/);
  assert.match(vertical, /9 50C/);
  assert.match(vertical, /L0 0$/);
});

test('multiple separated crossings render separately while overlapping jumps are skipped', () => {
  const crossings = [30, 35, 30, 80, 140].map(x => line(x, -50, x, 50));
  const path = pipePath(line(0, 0, 180, 0), crossings);
  assert.equal(count(path, 'C'), 6);
  assert.equal(count(path, 'Q'), 0);
  finite(path);
});

test('corners remain rounded and crossings stay clear of their rounded portions', () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const path = pipePath(points, [line(50, -50, 50, 50), line(90, -50, 90, 50)]);
  assert.equal(count(path, 'C'), 2);
  assert.match(path, /L89 0Q100 0 100 11L100 100$/);
  finite(path);
});

test('collinear routing points do not create artificial corner exclusions', () => {
  const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
  assert.equal(count(pipePath(points, [line(50, -50, 50, 50)]), 'C'), 2);
});

test('empty, repeated, very short, and invalid geometry remains finite', () => {
  assert.equal(pipePath([]), '');
  assert.equal(pipePath(null), '');
  assert.equal(pipePath([{ x: 1, y: 2 }, { x: 1, y: 2 }]), 'M1 2');
  assert.equal(pipePath([{ x: NaN, y: 1 }, { x: 5, y: 7 }]), 'M5 7');
  for (const points of [line(0, 0, 1, 0), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]]) {
    finite(pipePath(points, [line(.5, -50, .5, 50)]));
  }
});

test('diagonal crossings produce rotated semicircular bridges', () => {
  const path = pipePath(line(0, 0, 100, 100), [line(0, 100, 100, 0)]);
  assert.equal(count(path, 'C'), 2);
  assert.match(path, /^M0 0L43\.636 43\.636C/);
  assert.match(path, /56\.364 43\.636C/);
  assert.match(path, /L100 100$/);
  finite(path);
});

test('shallow-angle crossings stay finite while nonintersecting diagonals remain straight', () => {
  const shallow = pipePath(line(0, 0, 1000, 10), [line(0, 10, 1000, 0)]);
  assert.equal(count(shallow, 'C'), 2);
  finite(shallow);
  const outside = pipePath(line(0, 0, 100, 100), [line(0, 150, 50, 100)]);
  assert.equal(outside, 'M0 0L100 100');
  const parallel = pipePath(line(0, 0, 100, 100), [line(0, 10, 100, 110)]);
  assert.equal(parallel, 'M0 0L100 100');
});

test('reversing a diagonal preserves the physical bridge and its perpendicular side', () => {
  const crossing = [line(0, 100, 100, 0)];
  const forward = pipePath(line(0, 0, 100, 100), crossing);
  const reverse = pipePath(line(100, 100, 0, 0), crossing);
  const coordinates = path => {
    const values = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const pairs = [];
    for (let index = 0; index < values.length; index += 2) pairs.push(`${values[index]},${values[index + 1]}`);
    return [...new Set(pairs)].sort();
  };
  assert.deepEqual(coordinates(forward), coordinates(reverse));
  assert.match(reverse, /56\.364 43\.636C/);
  finite(reverse);
});

test('diagonal shared endpoints and T contacts do not create bridge marks', () => {
  assert.equal(pipePath(line(0, 0, 100, 100), [line(100, 100, 200, 0)]), 'M0 0L100 100');
  assert.equal(pipePath(line(0, 0, 100, 100), [line(50, 50, 100, 0)]), 'M0 0L100 100');
});
