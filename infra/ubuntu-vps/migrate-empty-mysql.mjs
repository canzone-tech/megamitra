#!/usr/bin/env node
// Explicit one-time exception: migrate ONLY an empty dedicated local MySQL
// schema. No other DB, existing service, source checkout or PM2 action.
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {constants,closeSync,fstatSync,lstatSync,mkdtempSync,mkdirSync,openSync,
 readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
const here=dirname(fileURLToPath(import.meta.url));
const BASE='/etc/megagoldenclub', DB='megagoldenclub';
const APP='megagoldenclub_app', MIGRATOR='megagoldenclub_migrate_once';
function stop(s){throw new Error('STOP: '+s);}
export function gitBlobSha(b){
  const bytes=Buffer.from(b);
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
export function checkManifest(manifest){
  if(!/^[a-f0-9]{40}$/.test(manifest?.sourceSha??'') ||
    manifest.expectedMigrations!==41 || manifest.files?.length!==43)
    stop('migration manifest identity/count invalid');
  const seen=new Set(),nums=[];
  for(const item of manifest.files){
    if(typeof item.path!=='string'||seen.has(item.path)||!/^[0-9a-f]{40}$/.test(item.blobSha))
      stop('invalid migration file manifest');
    seen.add(item.path);
    if(item.path.startsWith('backend/prisma/migrations/')){
      const m=item.path.match(/^backend\/prisma\/migrations\/(00[0-4][0-9])_[a-z0-9_]+\/migration\.sql$/);
      if(!m)stop('unsafe migration path');
      nums.push(Number(m[1]));
    }else if(!['backend/prisma.config.ts','backend/prisma/schema.prisma'].includes(item.path))
      stop('unexpected migration-runner file');
  }
  nums.sort((a,b)=>a-b);
  if(nums.length!==41||nums.some((n,i)=>n!==i+1)||
    !seen.has('backend/prisma.config.ts')||!seen.has('backend/prisma/schema.prisma'))
    stop('migration manifest incomplete');
  return true;
}
function run(program,args,opts={}){
  const r=spawnSync(program,args,{encoding:'utf8',
    stdio:opts.stdio??['ignore','pipe','pipe'],input:opts.input,cwd:opts.cwd,
    env:opts.env,timeout:opts.timeout??120000});
  if(r.error||r.status!==0)stop((opts.label??'required command')+' failed; inspect privately');
  return r.stdout??'';
}
function getAppPassword(){
  const group=readFileSync('/etc/group','utf8').split('\n').find(x=>x.startsWith('megagoldenclub:'));
  if(!group)stop('dedicated group missing');
  const gid=Number(group.split(':')[2]);
  const dir=lstatSync(BASE),file=lstatSync(BASE+'/api.env');
  if(!Number.isSafeInteger(gid)||gid<=0||!dir.isDirectory()||dir.isSymbolicLink()||
    dir.uid!==0||dir.gid!==gid||(dir.mode&0o777)!==0o750||
    !file.isFile()||file.isSymbolicLink()||file.uid!==0||file.gid!==gid||
    (file.mode&0o777)!==0o640||file.size<1)
    stop('protected API environment permissions invalid');
  const fd=openSync(BASE+'/api.env',constants.O_RDONLY|constants.O_NOFOLLOW);
  let env;
  try{
    const s=fstatSync(fd);
    if(s.uid!==0||s.gid!==gid||(s.mode&0o777)!==0o640)stop('api.env identity changed');
    env=parseEnv(readFileSync(fd,'utf8'));
  }finally{closeSync(fd);}
  for(const [k,v] of Object.entries({NODE_ENV:'production',
    MEGAGOLDENCLUB_DATA_TOPOLOGY:'local-isolated',MYSQL_HOST:'127.0.0.1',
    MYSQL_PORT:'3306',MYSQL_DATABASE:DB,MYSQL_USER:APP,MYSQL_TLS:'false'}))
    if(env[k]!==v)stop('invalid dedicated database setting: '+k);
  if(!/^[0-9a-f]{64}$/.test(env.MYSQL_PASSWORD??''))stop('unexpected app password format');
  return env.MYSQL_PASSWORD;
}
const appArgs=['--protocol=tcp','--host=127.0.0.1','--port=3306','--database='+DB,
  '--batch','--silent','--skip-column-names','--connect-timeout=5'];
function query(cnf,sql){
  const output=run('mysql',['--defaults-extra-file='+cnf,...appArgs,'--execute='+sql],
    {timeout:10000,label:'read-only dedicated database query'}).trim();
  if(output.length>1024)stop('unexpected metadata response');
  return output;
}
function count(x){
  if(!/^(0|[1-9][0-9]*)$/.test(x)||!Number.isSafeInteger(Number(x)))
    stop('unexpected metadata count');
  return Number(x);
}
function checkEmpty(cnf){
  const identity=query(cnf,'SELECT CURRENT_USER(),DATABASE()').split('\t');
  if(identity[0]!==APP+'@127.0.0.1'||identity[1]!==DB||identity.length!==2)
    stop('dedicated MySQL identity mismatch');
  if(count(query(cnf,"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='megagoldenclub'"))!==0)
    stop('target database is NOT empty; no migration permitted');
}
function rootSql(sql){
  // The MySQL client prompts privately through /dev/tty; root password is NOT
  // in this process environment, a file, a command argument, or stdout.
  run('mysql',['--protocol=socket','--user=root','--password','--batch','--silent'],
    {stdio:['pipe','inherit','inherit'],input:sql,root:true,label:'MySQL root SQL'});
}
async function download(file,manifest,backend){
  const url='https://raw.githubusercontent.com/canzone-tech/megamitra/'+
    manifest.sourceSha+'/'+file.path;
  const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!res.ok)stop('pinned migration download failed');
  const bytes=Buffer.from(await res.arrayBuffer());
  if(bytes.length<1||bytes.length>2000000||gitBlobSha(bytes)!==file.blobSha)
    stop('pinned Git blob hash mismatch');
  const dest=join(backend,file.path.slice('backend/'.length));
  mkdirSync(dirname(dest),{recursive:true,mode:0o700});
  writeFileSync(dest,bytes,{flag:'wx',mode:0o600});
}
function confirmPostMigration(cnf){
  const applied=count(query(cnf,'SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'));
  const failed=count(query(cnf,'SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL'));
  if(applied!==41||failed!==0)stop('migration ledger not at 41 successfully applied');
  const tables=count(query(cnf,"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='megagoldenclub'"));
  if(tables<42)stop('application schema not completely created');
  console.log('Applied Prisma migrations: 41/41');
  console.log('Dedicated application tables: '+tables);
  console.log('ONE-TIME EMPTY DATABASE MIGRATION: PASS');
  console.log('BACKUP NOT VERIFIED: real financial transactions remain HOLD');
}
async function main(){
  if(process.getuid()!==0||process.argv.length!==2)stop('root only; no arguments');
  const manifest=JSON.parse(readFileSync(join(here,'empty-db-migration-manifest.json'),'utf8'));
  checkManifest(manifest);
  const pass=getAppPassword();
  const tmp=mkdtempSync('/root/megagoldenclub-migration-runner-');
  const backend=join(tmp,'backend');
  mkdirSync(backend,{mode:0o700});
  const cnf=join(tmp,'mysql-app.cnf');
  writeFileSync(cnf,'[client]\nuser='+APP+'\npassword='+pass+'\n',{flag:'wx',mode:0o600});
  let created=false,failed=false;
  try{
    console.log('=== CHECK EMPTY DEDICATED DATABASE ===');
    checkEmpty(cnf);
    console.log('Dedicated MySQL database empty: PASS');
    console.log('=== DOWNLOAD CHECKSUM-PINNED PRISMA MIGRATIONS ===');
    for(let i=0;i<manifest.files.length;i+=5)
      await Promise.all(manifest.files.slice(i,i+5).map(f=>download(f,manifest,backend)));
    console.log('41 migrations + schema + CLI config: HASH VERIFIED');
    writeFileSync(join(backend,'package.json'),
      '{"name":"megagoldenclub-temporary-migrator","private":true,"type":"module"}\n',
      {flag:'wx',mode:0o600});
    run('npm',['install','--prefix',backend,'--no-save','--no-audit','--no-fund',
      'prisma@7.10.0','dotenv@17.4.1'],
      {stdio:'inherit',timeout:180000,label:'temporary pinned Prisma installation'});
    checkEmpty(cnf);
    const tmpPass=randomBytes(32).toString('hex');
    console.log('=== CREATE SCOPED TEMPORARY MIGRATION USER ===');
    console.log('Enter the existing MySQL root password at the private prompt.');
    rootSql("CREATE USER '"+MIGRATOR+"'@'127.0.0.1' IDENTIFIED BY '"+tmpPass+"';\n");
    created=true;
    rootSql("GRANT ALL PRIVILEGES ON megagoldenclub.* TO '"+MIGRATOR+"'@'127.0.0.1';\n");
    const env={...process.env,DATABASE_URL:'mysql://'+MIGRATOR+':'+tmpPass+
      '@127.0.0.1:3306/'+DB,NODE_ENV:'production',PRISMA_HIDE_UPDATE_MESSAGE:'1'};
    const prisma=join(backend,'node_modules/prisma/build/index.js');
    for(const command of ['deploy','status']){
      console.log('=== PRISMA MIGRATE '+command.toUpperCase()+' ===');
      run(process.execPath,[prisma,'migrate',command,'--config',join(backend,'prisma.config.ts')],
        {cwd:backend,env,stdio:'inherit',timeout:command==='deploy'?600000:120000,
          label:'Prisma migration '+command});
    }
  }catch(error){
    failed=true;
    console.error(error instanceof Error?error.message:'STOP: migration failed');
    console.error('If migrations partially applied, DO NOT rerun automatically.');
  }finally{
    if(created){
      console.log('=== REMOVE TEMPORARY MIGRATION USER ===');
      console.log('Enter MySQL root password once more at the private prompt.');
      try{
        rootSql("DROP USER '"+MIGRATOR+"'@'127.0.0.1';\n");
        console.log('Temporary migration-only account removed: PASS');
      }catch{
        failed=true;
        console.error('STOP: DDL account cleanup unverified; investigate before launch');
      }
    }
    if(!failed)try{confirmPostMigration(cnf);}catch(e){
      failed=true;
      console.error(e instanceof Error?e.message:'STOP: migration verification failed');
    }
    rmSync(tmp,{recursive:true,force:true});
  }
  if(failed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await main().catch(e=>{
    console.error(e instanceof Error?e.message:'STOP: temporary migration runner failed');
    process.exitCode=1;
  });
