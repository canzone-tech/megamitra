import { ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mariadb';
import { Prisma } from '../generated/prisma/client';
import { generateLuckyDrawToken, LUCKY_DRAW_TOKEN_COLLISION_RETRIES } from '../lucky-draw/lucky-draw-token.util';

type DrawRow = { enrollmentId:string; seasonId:string; drawTimezone:string; monthNumber:number; drawAt:Date|string;
  reservePercent:string|number; policyVersionId:string; enabled:number|boolean };
type Installment = { id:string; enrollmentId:string; sequence:number; amount:string|number; outstanding:string|number };
type Context = { installment:Installment; userId:string; currency:string; seasonId:string; policyVersionId:string; percent:Prisma.Decimal };
const dec=(value:string|number|Prisma.Decimal)=>new Prisma.Decimal(value).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
const fp=(value:string)=>createHash('sha256').update(value).digest('hex');
const reserveKey=(user:string,emi:string,currency:string)=>'EMI_RESERVE:'+user+':'+emi+':'+currency;

export function afterDrawDay(drawAt:Date|string, now:Date, tz:string) {
  const local=(at:Date)=>{
    const parts=new Intl.DateTimeFormat('en-GB',{ timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(at);
    const get=(type:string)=>parts.find(p=>p.type===type)?.value??'';
    return get('year')+'-'+get('month')+'-'+get('day');
  };
  return local(now)>local(new Date(drawAt));
}
async function getAccount(c:PoolConnection,code:string,kind:string,user:string|null,currency:string){
  await c.query(`INSERT INTO ledger_accounts(id,code,name,kind,ownerUserId,currencyCode,createdAt)
    VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE code=VALUES(code)`,
    [randomUUID(),code,code.slice(0,150),kind,user,currency]);
  const rows=await c.query<Array<{id:string}>>('SELECT id FROM ledger_accounts WHERE code=?',[code]);
  if(!rows[0]) throw new ConflictException('Recovery ledger account missing');
  return rows[0].id;
}
async function reserveBalance(c:PoolConnection,key:string){
  const rows=await c.query<Array<{balance:string|number}>>(`
    SELECT COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount ELSE -e.amount END),0) AS balance
    FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.accountId WHERE a.code=?`,[key]);
  return dec(rows[0]?.balance??0);
}
async function move(c:PoolConnection,source:string,kind:string,debit:string,credit:string,
  amount:Prisma.Decimal,currency:string,user:string){
  const id=randomUUID();
  await c.query(`INSERT INTO ledger_transactions(id,sourceKey,type,description,occurredAt,createdByUserId,createdAt)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP(3),?,CURRENT_TIMESTAMP(3))`,
    [id,source,kind,kind.replaceAll('_',' '),user]);
  await c.query(`INSERT INTO ledger_entries(id,transactionId,accountId,direction,amount,currencyCode,createdAt)
    VALUES(?,?,?,'DEBIT',?,?,CURRENT_TIMESTAMP(3)),(?,?,?,'CREDIT',?,?,CURRENT_TIMESTAMP(3))`,
    [randomUUID(),id,debit,amount.toFixed(2),currency,randomUUID(),id,credit,amount.toFixed(2),currency]);
  return id;
}
async function dueRows(c:PoolConnection,enrollment:string,max:number):Promise<Installment[]>{
  return c.query<Installment[]>(`SELECT i.id,i.enrollmentId,i.sequence,i.amount,
    GREATEST(0,i.amount-COALESCE(pa.paid,0)+COALESCE(ra.refunded,0)) AS outstanding
    FROM program_installments i
    LEFT JOIN (SELECT installmentId,SUM(amount) paid FROM program_payment_allocations
      WHERE allocationType='INSTALLMENT' GROUP BY installmentId) pa ON pa.installmentId=i.id
    LEFT JOIN (SELECT a.installmentId,SUM(r.amount) refunded FROM program_refund_allocations r
      JOIN program_payment_allocations a ON a.id=r.paymentAllocationId
      WHERE a.allocationType='INSTALLMENT' GROUP BY a.installmentId) ra ON ra.installmentId=i.id
    WHERE i.enrollmentId=? AND i.sequence<=? ORDER BY i.sequence`,[enrollment,max]);
}
async function selectTarget(c:PoolConnection,user:string,currency:string,now:Date):Promise<Context|null>{
  const rows=await c.query<DrawRow[]>(`SELECT e.id enrollmentId,s.id seasonId,s.drawTimezone,r.monthNumber,d.drawAt,
    p.id policyVersionId,p.reservePercent,p.enabled
    FROM program_enrollments e JOIN owner_seasons s ON s.programVersionId=e.programVersionId
    JOIN installment_recovery_policy_versions p ON p.seasonId=s.id AND p.lifecycle='PUBLISHED'
    JOIN owner_draw_runs r ON r.seasonId=s.id JOIN lucky_draw_instances d ON d.id=r.drawId
    WHERE e.userId=? AND e.currencyCode=? AND e.status IN ('ACTIVE','COMPLETED')
    AND s.status IN ('ACTIVE','CLOSED') AND r.status NOT IN ('VOIDED','CANCELLED')
    ORDER BY d.drawAt DESC,r.monthNumber DESC`,[user,currency]);
  const latest=new Map<string,DrawRow>();
  for(const row of rows){
    if(latest.has(row.enrollmentId))continue;
    if(Number(row.enabled)===0||Number(row.reservePercent)<=0)continue;
    if(!afterDrawDay(row.drawAt,now,row.drawTimezone||'Asia/Kolkata'))continue;
    latest.set(row.enrollmentId,row);
  }
  for(const row of latest.values()){
    // Month N's draw enables recovery for EMI N+1 (or an earlier missed EMI).
    const due=(await dueRows(c,row.enrollmentId,Number(row.monthNumber)+1))
      .find(i=>dec(i.outstanding).greaterThan(0));
    if(due)return{installment:due,userId:user,currency,seasonId:row.seasonId,
      policyVersionId:row.policyVersionId,percent:new Prisma.Decimal(row.reservePercent)};
  }
  return null;
}
async function createToken(c:PoolConnection,ctx:Context,payment:string,allocation:string){
  const previous=await c.query<Array<{token:string}>>(
    'SELECT token FROM lucky_draw_tokens WHERE enrollmentId=? AND installmentId=? LIMIT 1',
    [ctx.installment.enrollmentId,ctx.installment.id]);
  if(previous.length)return;
  for(let i=0;i<LUCKY_DRAW_TOKEN_COLLISION_RETRIES;i++){
    try{
      await c.query(`INSERT INTO lucky_draw_tokens(token,seasonId,sourceType,userId,enrollmentId,
        installmentId,installmentSequence,paymentRecordId,paymentAllocationId,status,createdAt)
        VALUES(?,?,'INSTALLMENT',?,?,?,?,?,?,'AVAILABLE',CURRENT_TIMESTAMP(3))`,
        [generateLuckyDrawToken(),ctx.seasonId,ctx.userId,ctx.installment.enrollmentId,
          ctx.installment.id,ctx.installment.sequence,payment,allocation]);
      return;
    }catch(e){
      if((e as {code?:string}).code!=='ER_DUP_ENTRY')throw e;
      const raced=await c.query<Array<{token:string}>>(
        'SELECT token FROM lucky_draw_tokens WHERE enrollmentId=? AND installmentId=?',
        [ctx.installment.enrollmentId,ctx.installment.id]);
      if(raced.length)return;
    }
  }
  throw new ConflictException('Recovery Lucky Draw token allocation failed');
}
async function settle(c:PoolConnection,ctx:Context,due:Prisma.Decimal,reserved:Prisma.Decimal,source:string){
  if(reserved.lessThan(due)&&due.greaterThan(0))return;
  if(reserved.lessThanOrEqualTo(0))return;
  const rId=await getAccount(c,reserveKey(ctx.userId,ctx.installment.id,ctx.currency),
    'USER_INSTALLMENT_RESERVE',ctx.userId,ctx.currency);
  if(due.greaterThan(0)){
    const existing=await c.query<Array<{id:string}>>(
      'SELECT id FROM installment_recovery_settlements WHERE installmentId=?',[ctx.installment.id]);
    if(existing.length)return;
    const clearing=await getAccount(c,'SYS:INSTALLMENT_RECOVERY:'+ctx.currency,
      'INSTALLMENT_RECOVERY_CLEARING',null,ctx.currency);
    const tx=await move(c,'EMI_AUTOPAY:'+ctx.installment.id,'INSTALLMENT_AUTO_PAYMENT',
      rId,clearing,due,ctx.currency,ctx.userId);
    const attempt=randomUUID(),payment=randomUUID(),allocation=randomUUID();
    const key='EMI_RECOVERY:'+ctx.installment.id;
    const hash=fp(key+':'+due.toFixed(2));
    const meta=JSON.stringify({source:'INCOME_RESERVE',installmentId:ctx.installment.id,
      policyVersionId:ctx.policyVersionId,ledgerTransactionId:tx});
    await c.query(`INSERT INTO program_payment_attempts
      (id,sourceKey,requestFingerprint,enrollmentId,amount,currencyCode,provider,status,
       initiatedAt,finalizedAt,metadata,createdByUserId,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,'INCOME_RESERVE','CONFIRMED',CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3),
        ?,?,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`,
      [attempt,key+':ATTEMPT',hash,ctx.installment.enrollmentId,due.toFixed(2),ctx.currency,meta,ctx.userId]);
    await c.query(`INSERT INTO program_payment_records
      (id,sourceKey,requestFingerprint,paymentAttemptId,enrollmentId,amount,currencyCode,
       provider,occurredAt,metadata,createdByUserId,createdAt)
      VALUES(?,?,?,?,?,?,?,'INCOME_RESERVE',CURRENT_TIMESTAMP(3),?,?,CURRENT_TIMESTAMP(3))`,
      [payment,key+':PAYMENT',hash,attempt,ctx.installment.enrollmentId,due.toFixed(2),
        ctx.currency,meta,ctx.userId]);
    await c.query(`INSERT INTO program_payment_allocations
      (id,paymentRecordId,enrollmentId,allocationType,installmentId,amount,createdAt)
      VALUES(?,?,?,'INSTALLMENT',?,?,CURRENT_TIMESTAMP(3))`,
      [allocation,payment,ctx.installment.enrollmentId,ctx.installment.id,due.toFixed(2)]);
    await c.query(`INSERT INTO installment_recovery_settlements
      (id,installmentId,userId,paymentRecordId,ledgerTransactionId,amount)
      VALUES(?,?,?,?,?,?)`,[randomUUID(),ctx.installment.id,ctx.userId,payment,tx,due.toFixed(2)]);
    await c.query(`INSERT INTO program_business_events
      (id,sourceKey,type,enrollmentId,paymentRecordId,refundRecordId,occurredAt,payload,createdAt)
      VALUES(?,?,'PAYMENT_CONFIRMED',?,?,NULL,CURRENT_TIMESTAMP(3),?,CURRENT_TIMESTAMP(3))`,
      [randomUUID(),'PROGRAM_PAYMENT:'+payment+':CONFIRMED',ctx.installment.enrollmentId,payment,meta]);
    await createToken(c,ctx,payment,allocation);
    const remaining=await dueRows(c,ctx.installment.enrollmentId,9999);
    if(remaining.every(x=>dec(x.outstanding).equals(0))){
      await c.query(`UPDATE program_enrollments SET status='COMPLETED',updatedAt=CURRENT_TIMESTAMP(3)
        WHERE id=? AND status='ACTIVE'`,[ctx.installment.enrollmentId]);
      await c.query(`INSERT INTO program_business_events
        (id,sourceKey,type,enrollmentId,paymentRecordId,refundRecordId,occurredAt,payload,createdAt)
        VALUES(?,?,'ENROLLMENT_COMPLETED',?,?,NULL,CURRENT_TIMESTAMP(3),?,CURRENT_TIMESTAMP(3))`,
        [randomUUID(),'PROGRAM_ENROLLMENT:'+ctx.installment.enrollmentId+':COMPLETED:'+payment,
          ctx.installment.enrollmentId,payment,JSON.stringify({reason:'FULLY_PAID'})]);
    }
  }
  const extra=reserved.minus(due);
  if(extra.greaterThan(0)){
    const wallet=await getAccount(c,'USER_WALLET:'+ctx.userId+':'+ctx.currency,
      'USER_WALLET',ctx.userId,ctx.currency);
    await move(c,'EMI_RELEASE:'+source+':'+ctx.installment.id,'INSTALLMENT_RESERVE_RELEASE',
      rId,wallet,extra,ctx.currency,ctx.userId);
  }
}

/** Executed within the ORIGINAL earning posting transaction; never retroactively sweeps wallet. */
export async function applyInstallmentReserveOnEarning(c:PoolConnection,input:{
  userId:string;currencyCode:string;amount:string|number|Prisma.Decimal;earningTransactionId:string;now?:Date;
}){
  const income=dec(input.amount);
  if(income.lessThanOrEqualTo(0))return;
  await c.query('SELECT id FROM users WHERE id=? LIMIT 1 FOR UPDATE',[input.userId]);
  const prior=await c.query<Array<{id:string}>>(
    'SELECT id FROM installment_recovery_holds WHERE earningTransactionId=?',[input.earningTransactionId]);
  if(prior.length)return;
  const ctx=await selectTarget(c,input.userId,input.currencyCode,input.now??new Date());
  if(!ctx)return;
  const due=dec(ctx.installment.outstanding);
  const key=reserveKey(ctx.userId,ctx.installment.id,ctx.currency);
  const held=await reserveBalance(c,key);
  if(held.greaterThanOrEqualTo(due)){
    await settle(c,ctx,due,held,input.earningTransactionId);return;
  }
  const half=income.mul(ctx.percent).div(100).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
  const amount=Prisma.Decimal.max(0,Prisma.Decimal.min(half,due.minus(held)));
  if(amount.lessThanOrEqualTo(0))return;
  const wallet=await getAccount(c,'USER_WALLET:'+ctx.userId+':'+ctx.currency,
    'USER_WALLET',ctx.userId,ctx.currency);
  const reserve=await getAccount(c,key,'USER_INSTALLMENT_RESERVE',ctx.userId,ctx.currency);
  const tx=await move(c,'EMI_HOLD:'+input.earningTransactionId,'INSTALLMENT_RESERVE_HOLD',
    wallet,reserve,amount,ctx.currency,ctx.userId);
  await c.query(`INSERT INTO installment_recovery_holds
    (id,earningTransactionId,userId,installmentId,policyVersionId,amount,ledgerTransactionId)
    VALUES(?,?,?,?,?,?,?)`,
    [randomUUID(),input.earningTransactionId,ctx.userId,ctx.installment.id,
      ctx.policyVersionId,amount.toFixed(2),tx]);
  await settle(c,ctx,due,held.plus(amount),input.earningTransactionId);
}

/** Cash/UPI confirmation reconciles existing holds; fully paid external EMIs return unused reserve. */
export async function reconcileReserveAfterExternalPayment(c:PoolConnection,input:{
  userId:string;enrollmentId:string;currencyCode:string;paymentRecordId:string;
}){
  const rows=await c.query<Array<Installment & {seasonId:string;policyVersionId:string}>>(`
    SELECT i.id,i.enrollmentId,i.sequence,i.amount,
      GREATEST(0,i.amount-COALESCE(pa.paid,0)+COALESCE(ra.refunded,0)) outstanding,
      s.id seasonId,p.id policyVersionId
    FROM program_installments i JOIN program_enrollments e ON e.id=i.enrollmentId
    JOIN owner_seasons s ON s.programVersionId=e.programVersionId
    JOIN installment_recovery_policy_versions p ON p.seasonId=s.id AND p.lifecycle='PUBLISHED'
    LEFT JOIN (SELECT installmentId,SUM(amount) paid FROM program_payment_allocations
      WHERE allocationType='INSTALLMENT' GROUP BY installmentId) pa ON pa.installmentId=i.id
    LEFT JOIN (SELECT a.installmentId,SUM(r.amount) refunded FROM program_refund_allocations r
      JOIN program_payment_allocations a ON a.id=r.paymentAllocationId
      WHERE a.allocationType='INSTALLMENT' GROUP BY a.installmentId) ra ON ra.installmentId=i.id
    WHERE i.enrollmentId=? ORDER BY i.sequence`,[input.enrollmentId]);
  for(const row of rows){
    const ctx:Context={installment:row,userId:input.userId,currency:input.currencyCode,
      seasonId:row.seasonId,policyVersionId:row.policyVersionId,percent:new Prisma.Decimal(50)};
    const held=await reserveBalance(c,reserveKey(ctx.userId,row.id,ctx.currency));
    if(held.greaterThan(0))await settle(c,ctx,dec(row.outstanding),held,input.paymentRecordId);
  }
}
