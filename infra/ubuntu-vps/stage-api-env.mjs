#!/usr/bin/env node
// Ops-only one-time staging for the explicitly approved local-isolated VPS.
// No production API launch, migration, backup, credential rotation, or PM2 action.
import { randomBytes } from 'node:crypto';
import {
  chmodSync, chownSync, closeSync, constants, fstatSync, lstatSync,
  openSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = '/etc/megagoldenclub';
const FILES = ['mysql.credentials.env','mongo.credentials.env','redis.credentials.env'];
function must(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.length || /[\r\n\0]/.test(value)) {
    throw new Error('STOP: invalid or missing ' + key);
  }
  return value;
}
function strong(env, key) {
  const value = must(env,key);
  if (value.length < 16 || /change.?me|replace.?me|test.password|ci.secret|^password$|^secret$/i.test(value)) {
    throw new Error('STOP: invalid production secret ' + key);
  }
  return value;
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error('STOP: unexpected ' + label);
}
export function buildApiEnv(mysql,mongo,redis,newKey=()=>randomBytes(48).toString('hex')) {
  const mypass=strong(mysql,'MYSQL_PASSWORD');
  const redpass=strong(redis,'REDIS_PASSWORD');
  for (const [data, expected, prefix] of [
    [mysql,{MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'3306',MYSQL_DATABASE:'megagoldenclub',MYSQL_USER:'megagoldenclub_app',MYSQL_TLS:'false'},'MySQL'],
    [redis,{REDIS_HOST:'127.0.0.1',REDIS_PORT:'6381',REDIS_TLS:'false'},'Redis'],
  ]) {
    for(const [key,value] of Object.entries(expected))eq(must(data,key),value,prefix+' '+key);
  }
  const mongoUri=must(mongo,'MONGODB_URI');
  let uri;
  try { uri=new URL(mongoUri); } catch { throw new Error('STOP: invalid MongoDB URI'); }
  for (const [actual,value,label] of [
    [uri.protocol,'mongodb:','MongoDB protocol'],
    [uri.hostname,'127.0.0.1','MongoDB host'],
    [uri.port,'27019','MongoDB port'],
    [decodeURIComponent(uri.pathname),'/megagoldenclub','MongoDB database'],
    [decodeURIComponent(uri.username),'megagoldenclub_app','MongoDB username'],
    [uri.searchParams.get('authSource'),'megagoldenclub','MongoDB authSource'],
  ]) eq(actual,value,label);
  strong({MONGO_PASS:decodeURIComponent(uri.password)},'MONGO_PASS');
  for (const key of ['tlsInsecure','tlsAllowInvalidCertificates','tlsAllowInvalidHostnames']) {
    if(uri.searchParams.get(key)==='true')throw new Error('STOP: MongoDB URI disables TLS verification');
  }
  const keys=[newKey(),newKey(),newKey()];
  if(keys.some(key=>!/^[a-f0-9]{96}$/.test(key)) || new Set(keys).size!==3)
    throw new Error('STOP: signing key generation failed');
  return {
    NODE_ENV:'production',
    MEGAGOLDENCLUB_DATA_TOPOLOGY:'local-isolated',
    DATABASE_URL:'mysql://'+encodeURIComponent(mysql.MYSQL_USER)+':'+encodeURIComponent(mypass)+'@127.0.0.1:3306/megagoldenclub',
    MYSQL_HOST:mysql.MYSQL_HOST, MYSQL_PORT:mysql.MYSQL_PORT,
    MYSQL_DATABASE:mysql.MYSQL_DATABASE, MYSQL_USER:mysql.MYSQL_USER,
    MYSQL_PASSWORD:mypass, MYSQL_TLS:mysql.MYSQL_TLS,
    MONGODB_URI:mongoUri,
    REDIS_HOST:redis.REDIS_HOST, REDIS_PORT:redis.REDIS_PORT,
    REDIS_PASSWORD:redpass, REDIS_TLS:redis.REDIS_TLS,
    CAPTCHA_HMAC_SECRET:keys[0], JWT_ACCESS_SECRET:keys[1], JWT_REFRESH_SECRET:keys[2],
    TRUST_PROXY_HOPS:'1',
    SECURITY_HSTS_ENABLED:'true',
    RATE_LIMIT_ENABLED:'true', RATE_LIMIT_TEST_ENABLED:'false',
    MEGAGOLDENCLUB_PUBLIC_URL:'https://www.megagoldenclub.com',
  };
}
function readProtected(file,uid,gid) {
  const lstat=lstatSync(file);
  if(!lstat.isFile() || lstat.isSymbolicLink() || lstat.uid!==uid ||
    lstat.gid!==gid || (lstat.mode & 0o777)!==0o640 || lstat.size===0)
    throw new Error('STOP: unexpected credential file protection: '+file.split('/').at(-1));
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile() || stat.uid!==uid || stat.gid!==gid || (stat.mode & 0o777)!==0o640)
      throw new Error('STOP: credential file identity changed');
    return parseEnv(readFileSync(fd,'utf8'));
  } finally { closeSync(fd); }
}
// Only imported tests may pass a fixture path; CLI fixes /etc/megagoldenclub.
export function stageApiEnv({rootDir,uid,gid}) {
  if(process.getuid()!==uid)throw new Error('STOP: wrong OS identity');
  const dir=lstatSync(rootDir);
  if(!dir.isDirectory() || dir.isSymbolicLink() || dir.uid!==uid ||
    dir.gid!==gid || (dir.mode & 0o777)!==0o750)
    throw new Error('STOP: API config directory is not protected');
  const dest=join(rootDir,'api.env');
  try { lstatSync(dest); throw new Error('STOP: api.env already exists; refusing overwrite'); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
  const [mysql,mongo,redis]=FILES.map(name=>readProtected(join(rootDir,name),uid,gid));
  const env=buildApiEnv(mysql,mongo,redis);
  const payload=Object.entries(env).map(([key,value])=>{
    if(/[^\x21-\x7e]/.test(value) || /["'\\\s#]/.test(value))
      throw new Error('STOP: unsafe one-line env value: '+key);
    return key+'='+value+'\n';
  }).join('');
  let fd,created=false;
  try {
    fd=openSync(dest,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    created=true;
    writeFileSync(fd,payload,{encoding:'utf8'});
    chownSync(dest,uid,gid);
    chmodSync(dest,0o640);
    const stat=fstatSync(fd);
    if(stat.uid!==uid || stat.gid!==gid || (stat.mode & 0o777)!==0o640)
      throw new Error('STOP: API env file permissions incorrect');
  } catch(error) {
    if(created)unlinkSync(dest);
    throw error;
  } finally { if(fd!==undefined)closeSync(fd); }
  return Object.keys(env).length;
}
function serviceGid() {
  const group=readFileSync('/etc/group','utf8').split('\n')
    .find(line=>line.startsWith('megagoldenclub:'));
  if(!group)throw new Error('STOP: dedicated service group missing');
  const gid=Number(group.split(':')[2]);
  if(!Number.isSafeInteger(gid)||gid<1)throw new Error('STOP: invalid service GID');
  return gid;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.getuid()!==0||process.argv.length!==2)
      throw new Error('STOP: root-only script; no arguments accepted');
    const count=stageApiEnv({rootDir:ROOT,uid:0,gid:serviceGid()});
    console.log('API datastore configuration and distinct signing keys: STAGED (secrets hidden)');
    console.log('Protected api.env: root:megagoldenclub 0640');
    console.log('API environment variables: '+count);
    console.log('API ENV STAGING: PASS');
    console.log('API NOT STARTED; off-host recovery, migrations and approvals pending');
  } catch(error) {
    console.error(error instanceof Error?error.message:'STOP: API staging failed');
    process.exitCode=1;
  }
}
