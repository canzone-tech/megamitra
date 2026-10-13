#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gitBlobSha,checkManifest} from '../infra/ubuntu-vps/migrate-empty-mysql.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const manifest=JSON.parse(readFileSync(join(root,'infra/ubuntu-vps/empty-db-migration-manifest.json'),'utf8'));
assert.equal(checkManifest(manifest),true);
for(const entry of manifest.files)assert.equal(
  gitBlobSha(readFileSync(join(root,entry.path))),entry.blobSha,
  'migration changed: '+entry.path);
assert.throws(()=>checkManifest({...manifest,expectedMigrations:42}),/STOP/);
assert.throws(()=>checkManifest({...manifest,files:manifest.files.slice(1)}),/STOP/);
assert.throws(()=>checkManifest({...manifest,files:[{...manifest.files[0],path:'backend/src/main.ts'},...manifest.files.slice(1)]}),/STOP/);
console.log('Pinned temporary migration runner manifest and all 41 migrations: PASS');
