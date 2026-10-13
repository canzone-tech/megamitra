#!/usr/bin/env node
// One-time/read-repeatable production metadata inventory for the dedicated MySQL
// database only. No migrations, writes, backups or service restarts.
// Installed as an ops-only script (no Git checkout or source on the VPS).
import { spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync,
  readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const CONFIG='/etc/megagoldenclub/api.env';
const CONFIG_DIR='/etc/megagoldenclub';
const MYSQL_DB='megagoldenclub';
const MYSQL_USER='megagoldenclub_app';
const EXPECTED_ACCOUNT=MYSQL_USER+'@127.0.0.1';
const PROBE_BASE=[
  '--protocol=tcp','--host=127.0.0.1','--port=3306',
  '--database='+MYSQL_DB,'--batch','--skip-column-names',
  '--silent','--connect-timeout=5',
];
function assertValue(actual,expected,key){
  if(String(actual)!==expected)throw new Error('STOP: '+key+' does not match dedicated MySQL identity');
}
function numeric(s,key){
  if(!/^(0|[1-9][0-9]*)$/.test(String(s)) || !Number.isSafeInteger(Number(s)))
    throw new Error('STOP: invalid MySQL inventory '+key);
  return Number(s);
}
export function evaluateInventory(tables,migrationTable,stats){
  const tableCount=numeric(tables,'table count');
  const trackCount=numeric(migrationTable,'migration metadata count');
  if(trackCount>1)throw new Error('STOP: duplicate migration metadata table');
  if(trackCount===0){
    return { tableCount, status:tableCount===0?'EMPTY_SCHEMA':'UNTRACKED_SCHEMA',
      applied:0,unfinished:0,rolledBack:0,ready:false };
  }
  if(!Array.isArray(stats)||stats.length!==4)throw new Error('STOP: missing migration metadata');
  const [total,applied,unfinished,rolledBack]=stats.map((x,i)=>numeric(x,'migration count '+i));
  if(applied+unfinished+rolledBack!==total)throw new Error('STOP: inconsistent migration ledger');
  return {tableCount,status:unfinished?'UNFINISHED_MIGRATIONS':'TRACKED_REVIEW_REQUIRED',
    applied,unfinished,rolledBack,ready:false};
}
function getGroupId(){
  const line=readFileSync('/etc/group','utf8').split('\n')
    .find(s=>s.startsWith('megagoldenclub:'));
  if(!line)throw new Error('STOP: dedicated service group missing');
  const id=Number(line.split(':')[2]);
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('STOP: invalid service group');
  return id;
}
function readProtected(){
  const gid=getGroupId();
  const dir=lstatSync(CONFIG_DIR);
  if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==0||dir.gid!==gid||
      (dir.mode&0o777)!==0o750)
    throw new Error('STOP: API directory protection changed');
  const pre=lstatSync(CONFIG);
  if(!pre.isFile()||pre.isSymbolicLink()||pre.uid!==0||pre.gid!==gid||
      (pre.mode&0o777)!==0o640||pre.size===0)
    throw new Error('STOP: protected api.env identity changed');
  const fd=openSync(CONFIG,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.uid!==0||stat.gid!==gid||(stat.mode&0o777)!==0o640)
      throw new Error('STOP: API env identity changed during read');
    const env=parseEnv(readFileSync(fd,'utf8'));
    for(const [key,value] of [
      ['MEGAGOLDENCLUB_DATA_TOPOLOGY','local-isolated'],
      ['MYSQL_HOST','127.0.0.1'],['MYSQL_PORT','3306'],
      ['MYSQL_DATABASE',MYSQL_DB],['MYSQL_USER',MYSQL_USER],['MYSQL_TLS','false'],
    ])assertValue(env[key],value,key);
    if(!/^[a-f0-9]{64}$/.test(env.MYSQL_PASSWORD||''))
      throw new Error('STOP: saved MySQL credential format is invalid');
    return env.MYSQL_PASSWORD;
  }finally{closeSync(fd);}
}
function mysqlQuery(tempFile,sql){
  const result=spawnSync('mysql',
    ['--defaults-extra-file='+tempFile,...PROBE_BASE,'--execute='+sql],
    {encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});
  if(result.error||result.status!==0)
    throw new Error('STOP: dedicated MySQL read-only metadata query failed; investigate privately');
  const out=result.stdout.trim();
  if(out.length>1024||!out)throw new Error('STOP: unexpected MySQL metadata response');
  return out;
}
function main(){
  if(process.getuid()!==0||process.argv.length!==2)
    throw new Error('STOP: root-only read-only inspection; no arguments accepted');
  const password=readProtected();
  const dir=mkdtempSync('/root/megagoldenclub-mysql-inventory.XXXXXX');
  try{
    const extra=join(dir,'mysql.cnf');
    // The password is generated as hex and never enters mysql argv, logs,
    // environment variables or console output.
    writeFileSync(extra,'[client]\nuser='+MYSQL_USER+'\npassword='+password+'\n',
      {flag:'wx',mode:0o600});
    const identity=mysqlQuery(extra,'SELECT CURRENT_USER(), DATABASE()').split('\t');
    if(identity.length!==2||identity[0]!==EXPECTED_ACCOUNT||identity[1]!==MYSQL_DB)
      throw new Error('STOP: connected MySQL identity is not the dedicated app account');
    const tables=mysqlQuery(extra,
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='megagoldenclub' AND table_type='BASE TABLE'");
    const ledger=mysqlQuery(extra,
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='megagoldenclub' AND table_name='_prisma_migrations'");
    const stats=numeric(ledger,'ledger table')===1
      ? mysqlQuery(extra,
        'SELECT COUNT(*),'+
        'COALESCE(SUM(CASE WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN 1 ELSE 0 END),0),'+
        'COALESCE(SUM(CASE WHEN finished_at IS NULL AND rolled_back_at IS NULL THEN 1 ELSE 0 END),0),'+
        'COALESCE(SUM(CASE WHEN rolled_back_at IS NOT NULL THEN 1 ELSE 0 END),0)'+
        ' FROM _prisma_migrations').split('\t')
      : null;
    const inventory=evaluateInventory(tables,ledger,stats);
    console.log('Dedicated MySQL identity: VERIFIED');
    console.log('Dedicated MySQL schema table count: '+inventory.tableCount);
    console.log('Migration metadata: '+inventory.status);
    console.log('Applied migrations: '+inventory.applied);
    console.log('Unfinished migrations: '+inventory.unfinished);
    console.log('Rolled-back migrations: '+inventory.rolledBack);
    console.log('MYSQL SCHEMA INVENTORY: PASS (READ-ONLY)');
    console.log('Migration approval: PENDING separate migration-runner/schema review');
    console.log('Backup/recovery: NOT VERIFIED (operator requested skip; live finance remains HOLD)');
    console.log('No data modifications, service restarts or deployment performed.');
  }finally{rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(e){
    console.error(e instanceof Error?e.message:'STOP: MySQL schema inventory failed');
    process.exitCode=1;
  }
}
