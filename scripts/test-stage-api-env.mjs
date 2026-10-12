#!/usr/bin/env node
// Synthetic credentials only; never reads /etc/megagoldenclub.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,readFileSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {buildApiEnv,stageApiEnv} from '../infra/ubuntu-vps/stage-api-env.mjs';
const mysql={MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'3306',MYSQL_DATABASE:'megagoldenclub',MYSQL_USER:'megagoldenclub_app',MYSQL_PASSWORD:'8f21adf7c62eb691f504c270d73ef4e7',MYSQL_TLS:'false'};
const mongo={MONGODB_URI:'mongodb://megagoldenclub_app:9f21adf7c62eb691f504c270d73ef4e8@127.0.0.1:27019/megagoldenclub?authSource=megagoldenclub'};
const redis={REDIS_HOST:'127.0.0.1',REDIS_PORT:'6381',REDIS_PASSWORD:'af21adf7c62eb691f504c270d73ef4e9',REDIS_TLS:'false'};
assert.throws(()=>buildApiEnv(mysql,mongo,redis,()=> 'a'.repeat(96)),/signing key generation/);
const built=buildApiEnv(mysql,mongo,redis);
assert.equal(built.MEGAGOLDENCLUB_DATA_TOPOLOGY,'local-isolated');
assert.equal(new URL(built.DATABASE_URL).password,mysql.MYSQL_PASSWORD);
assert.equal(new Set([built.JWT_ACCESS_SECRET,built.JWT_REFRESH_SECRET,built.CAPTCHA_HMAC_SECRET]).size,3);
for(const s of [built.JWT_ACCESS_SECRET,built.JWT_REFRESH_SECRET,built.CAPTCHA_HMAC_SECRET])assert.match(s,/^[a-f0-9]{96}$/);
assert.throws(()=>buildApiEnv({...mysql,MYSQL_PORT:'3307'},mongo,redis),/MySQL MYSQL_PORT/);
assert.throws(()=>buildApiEnv(mysql,mongo,{...redis,REDIS_PORT:'6379'}),/Redis REDIS_PORT/);
assert.throws(()=>buildApiEnv(mysql,{MONGODB_URI:mongo.MONGODB_URI.replace(':27019/',':27018/')},redis),/MongoDB port/);
const root=mkdtempSync(join(tmpdir(),'megagoldenclub-api-staging-test-'));
try {
  chmodSync(root,0o750);
  for(const [name,values] of Object.entries({
    'mysql.credentials.env':mysql,'mongo.credentials.env':mongo,'redis.credentials.env':redis,
  })) {
    const file=join(root,name);
    writeFileSync(file,Object.entries(values).map(([k,v])=>k+'='+v+'\n').join(''),{mode:0o640});
    chmodSync(file,0o640);
  }
  const options={rootDir:root,uid:process.getuid(),gid:process.getgid()};
  stageApiEnv(options);
  const output=join(root,'api.env'),value=readFileSync(output,'utf8'),env=parseEnv(value);
  assert.equal(env.MYSQL_PASSWORD,mysql.MYSQL_PASSWORD);
  assert.equal(env.MONGODB_URI,mongo.MONGODB_URI);
  assert.equal(env.REDIS_PASSWORD,redis.REDIS_PASSWORD);
  assert.equal(env.RATE_LIMIT_TEST_ENABLED,'false');
  assert.equal(statSync(output).mode&0o777,0o640);
  assert.throws(()=>stageApiEnv(options),/already exists/);
  assert.equal(readFileSync(output,'utf8'),value);
  rmSync(output);
  chmodSync(join(root,'mongo.credentials.env'),0o644);
  assert.throws(()=>stageApiEnv(options),/unexpected credential file protection/);
  assert.equal(existsSync(output),false);
} finally {rmSync(root,{recursive:true,force:true});}
console.log('One-time protected API env staging regression: PASS');
