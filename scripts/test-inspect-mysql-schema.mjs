#!/usr/bin/env node
import assert from 'node:assert/strict';
import { evaluateInventory } from '../infra/ubuntu-vps/inspect-mysql-schema.mjs';
assert.deepEqual(evaluateInventory('0','0',null),{
  tableCount:0,status:'EMPTY_SCHEMA',applied:0,unfinished:0,rolledBack:0,ready:false});
assert.deepEqual(evaluateInventory('5','0',null),{
  tableCount:5,status:'UNTRACKED_SCHEMA',applied:0,unfinished:0,rolledBack:0,ready:false});
assert.deepEqual(evaluateInventory('16','1',['3','3','0','0']),{
  tableCount:16,status:'TRACKED_REVIEW_REQUIRED',applied:3,unfinished:0,rolledBack:0,ready:false});
assert.deepEqual(evaluateInventory('17','1',['3','2','1','0']),{
  tableCount:17,status:'UNFINISHED_MIGRATIONS',applied:2,unfinished:1,rolledBack:0,ready:false});
assert.deepEqual(evaluateInventory('17','1',['4','2','0','2']),{
  tableCount:17,status:'TRACKED_REVIEW_REQUIRED',applied:2,unfinished:0,rolledBack:2,ready:false});
for(const fn of [
  ()=>evaluateInventory('-1','0',null),
  ()=>evaluateInventory('5','2',null),
  ()=>evaluateInventory('5','1',['5','4','0','0']),
  ()=>evaluateInventory('5','1',null),
  ()=>evaluateInventory('x','0',null),
])assert.throws(fn,/STOP/);
console.log('Dedicated MySQL schema inventory pure regression: PASS');
