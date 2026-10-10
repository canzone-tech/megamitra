import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { FinancialDbService } from '../src/database/financial-db.service';
import { ProgramPaymentService } from '../src/program/program-payment.service';
import { applyInstallmentReserveOnEarning } from '../src/installment-recovery/installment-recovery.engine';
import { PolicyLifecycle, ProgramIntervalUnit, UserStatus } from '../src/generated/prisma/enums';

describe('After-draw 50% reserve, EMI autopayment, token and ledger integration', () => {
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  let prisma: PrismaService;
  let financial: FinancialDbService;
  const userId=randomUUID(),programId=randomUUID(),versionId=randomUUID();
  const enrollmentId=randomUUID(),firstId=randomUUID(),nextId=randomUUID();
  const seasonId=randomUUID(),policyId=randomUUID(),policyVersionId=randomUUID(),drawId=randomUUID();
  const runId=randomUUID(),ruleId=randomUUID(),walletId=randomUUID(),expenseId=randomUUID();
  const existingAttempt=randomUUID(),existingPayment=randomUUID(),existingAllocation=randomUUID();
  const suffix=randomUUID().replaceAll('-','').slice(0,10);
  let drawDate:Date;

  beforeAll(async () => {
    app=await NestFactory.createApplicationContext(AppModule,{logger:false});
    prisma=app.get(PrismaService);financial=app.get(FinancialDbService);
    const now=new Date();
    drawDate=new Date(now.getTime()-48*60*60*1000);
    await prisma.user.create({data:{id:userId,username:'emi_recovery_'+suffix,
      passwordHash:'recovery-test-not-for-login',status:UserStatus.ACTIVE}});
    await prisma.program.create({data:{id:programId,code:'EMIR'+suffix,name:'Recovery '+suffix}});
    await prisma.programVersion.create({data:{
      id:versionId,programId,version:1,lifecycle:PolicyLifecycle.PUBLISHED,
      effectiveFrom:new Date(now.getTime()-90*86400000),publishedAt:new Date(now.getTime()-90*86400000),
      currencyCode:'INR',registrationFee:'0.00',installmentAmount:'1000.00',installmentCount:2,
      installmentIntervalUnit:ProgramIntervalUnit.MONTH,installmentIntervalCount:1,
      firstInstallmentOffsetDays:0,gracePeriodDays:0,partialPaymentsAllowed:false,overpaymentsAllowed:false,
    }});
    await prisma.programEnrollment.create({data:{
      id:enrollmentId,sourceKey:'recovery:enrollment:'+suffix,requestFingerprint:'a'.repeat(64),
      userId,programVersionId:versionId,enrolledAt:new Date(now.getTime()-88*86400000),
      enrollmentDate:new Date(now.getTime()-88*86400000).toISOString().slice(0,10),
      status:'ACTIVE',eligibilitySnapshot:{eligible:true},currencyCode:'INR',
      registrationFeeSnapshot:'0.00',installmentAmountSnapshot:'1000.00',installmentCountSnapshot:2,
      gracePeriodDaysSnapshot:0,
    }});
    await prisma.$executeRawUnsafe(
      'INSERT INTO program_installments(id,enrollmentId,sequence,dueDate,amount) VALUES(?,?,1,?,1000),(?,?,2,?,1000)',
      firstId,enrollmentId,'2026-01-01',nextId,enrollmentId,'2026-02-01',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO program_payment_attempts(id,sourceKey,requestFingerprint,enrollmentId,amount,currencyCode,
        provider,status,initiatedAt,finalizedAt) VALUES(?,?,?, ?,1000,'INR','TEST','CONFIRMED',CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`,
      existingAttempt,'recovery:attempt:'+suffix,'b'.repeat(64),enrollmentId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO program_payment_records(id,sourceKey,requestFingerprint,paymentAttemptId,enrollmentId,amount,currencyCode,provider,occurredAt)
       VALUES(?,?,?,?,?,1000,'INR','TEST',CURRENT_TIMESTAMP(3))`,
      existingPayment,'recovery:paid:'+suffix,'c'.repeat(64),existingAttempt,enrollmentId,
    );
    await prisma.$executeRawUnsafe(
      "INSERT INTO program_payment_allocations(id,paymentRecordId,enrollmentId,allocationType,installmentId,amount) VALUES(?,?,?,'INSTALLMENT',?,1000)",
      existingAllocation,existingPayment,enrollmentId,firstId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO owner_seasons(id,code,name,status,startDate,drawDay,programVersionId,drawTimezone)
       VALUES(?,?,?,'ACTIVE',?,17,?,'Asia/Kolkata')`,
      seasonId,'EMIR'+suffix,'Recovery '+suffix,'2026-01-01',versionId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO installment_recovery_policy_versions(id,seasonId,version,lifecycle,enabled,reservePercent)
       VALUES(?,?,1,'PUBLISHED',TRUE,50.00)`,ruleId,seasonId,
    );
    await prisma.$executeRawUnsafe(
      'INSERT INTO lucky_draw_policies(id,code,name) VALUES(?,?,?)',policyId,'EMIR'+suffix,'Recovery draw '+suffix,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO lucky_draw_policy_versions(id,policyId,programVersionId,version,lifecycle,
       effectiveFrom,entryMode,priorWinnerMode,insufficientEntrantsMode)
       VALUES(?,?,?,1,'PUBLISHED',?,'PER_ELIGIBLE_HOOK','ALLOW','DRAW_AVAILABLE')`,
      policyVersionId,policyId,versionId,new Date(now.getTime()-90*86400000),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO lucky_draw_instances(id,sourceKey,requestFingerprint,policyVersionId,
       entryWindowStart,entryWindowEnd,drawAt,seedCommitment)
       VALUES(?,?,?,?,?,?,?,?)`,
      drawId,'recovery:draw:'+suffix,'d'.repeat(64),policyVersionId,
      new Date(now.getTime()-90*86400000),new Date(now.getTime()-3*86400000),drawDate,'e'.repeat(64),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO owner_draw_runs(id,seasonId,monthNumber,policyId,policyVersionId,drawId,status)
       VALUES(?,?,1,?,?,?,'SCHEDULED')`,
      runId,seasonId,policyId,policyVersionId,drawId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO ledger_accounts(id,code,name,kind,ownerUserId,currencyCode)
       VALUES(?,?,?,'USER_WALLET',?,'INR'),(?,?,?,'COMMISSION_EXPENSE',NULL,'INR')`,
      walletId,'USER_WALLET:'+userId+':INR','Recovery wallet '+suffix,userId,
      expenseId,'RECOVERY_TEST_EXPENSE:'+suffix,'Test expense '+suffix,
    );
  });

  afterAll(async () => {
    if(!prisma)return;
    await prisma.$executeRawUnsafe('DELETE FROM installment_recovery_settlements WHERE userId=?',userId);
    await prisma.$executeRawUnsafe('DELETE FROM installment_recovery_holds WHERE userId=?',userId);
    await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_tokens WHERE userId=?',userId);
    await prisma.$executeRawUnsafe('DELETE FROM program_business_events WHERE enrollmentId=?',enrollmentId);
    await prisma.$executeRawUnsafe('DELETE FROM program_payment_allocations WHERE enrollmentId=?',enrollmentId);
    await prisma.$executeRawUnsafe('DELETE FROM program_payment_records WHERE enrollmentId=?',enrollmentId);
    await prisma.$executeRawUnsafe('DELETE FROM program_payment_attempts WHERE enrollmentId=?',enrollmentId);
    await prisma.$executeRawUnsafe('DELETE FROM program_installments WHERE enrollmentId=?',enrollmentId);
    await prisma.$executeRawUnsafe('DELETE FROM owner_draw_runs WHERE seasonId=?',seasonId);
    await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_instances WHERE id=?',drawId);
    await prisma.$executeRawUnsafe('DELETE FROM installment_recovery_policy_versions WHERE seasonId=?',seasonId);
    await prisma.$executeRawUnsafe('DELETE FROM owner_seasons WHERE id=?',seasonId);
    await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_policy_versions WHERE id=?',policyVersionId);
    await prisma.$executeRawUnsafe('DELETE FROM lucky_draw_policies WHERE id=?',policyId);
    await prisma.$executeRawUnsafe(
      'DELETE FROM ledger_entries WHERE transactionId IN(SELECT id FROM ledger_transactions WHERE createdByUserId=?)',
      userId,
    );
    await prisma.$executeRawUnsafe('DELETE FROM ledger_transactions WHERE createdByUserId=?',userId);
    await prisma.$executeRawUnsafe("DELETE FROM ledger_accounts WHERE ownerUserId=? OR code=?",userId,'RECOVERY_TEST_EXPENSE:'+suffix);
    await prisma.programEnrollment.delete({where:{id:enrollmentId}});
    await prisma.programVersion.delete({where:{id:versionId}});
    await prisma.program.delete({where:{id:programId}});
    await prisma.user.delete({where:{id:userId}});
    await app?.close();
  });

  async function earn(amount:number,asOf:Date) {
    const id=randomUUID();
    await financial.transaction(async(c)=>{
      await c.query(
        `INSERT INTO ledger_transactions(id,sourceKey,type,description,occurredAt,createdByUserId)
         VALUES(?,?,'BINARY_PAIR_COMMISSION','Recovery test income',?,?)`,
        [id,'recovery:earning:'+id,asOf,userId],
      );
      await c.query(
        `INSERT INTO ledger_entries(id,transactionId,accountId,direction,amount,currencyCode)
         VALUES(?,?,?,'DEBIT',?,'INR'),(?,?,?,'CREDIT',?,'INR')`,
        [randomUUID(),id,expenseId,amount.toFixed(2),randomUUID(),id,walletId,amount.toFixed(2)],
      );
      await applyInstallmentReserveOnEarning(c,{
        userId,currencyCode:'INR',amount,earningTransactionId:id,now:asOf,
      });
    });
    return id;
  }
  const accountBalance=async(kind:string)=>{
    const rows=await prisma.$queryRawUnsafe<Array<{total:string|number}>>(
      `SELECT COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount ELSE -e.amount END),0) total
       FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.accountId
       WHERE a.kind=? AND a.ownerUserId=?`,kind,userId,
    );
    return Number(rows[0]?.total??0);
  };

  it('holds nothing before draw, holds half afterwards and automatically confirms an EMI only once',async()=>{
    const preDraw=new Date(drawDate.getTime()-2*86400000);
    const before=await earn(400,preDraw);
    expect(await accountBalance('USER_WALLET')).toBe(400);
    expect(await accountBalance('USER_INSTALLMENT_RESERVE')).toBe(0);
    const past= new Date(drawDate.getTime()+2*86400000);
    const ids=[];
    for(let i=0;i<5;i++)ids.push(await earn(400,past));
    expect(await accountBalance('USER_INSTALLMENT_RESERVE')).toBe(0);
    expect(await accountBalance('USER_WALLET')).toBe(1400);
    const payments=await prisma.$queryRawUnsafe<Array<{id:string;amount:string;provider:string}>>(
      "SELECT id,amount,provider FROM program_payment_records WHERE enrollmentId=? AND provider='INCOME_RESERVE'",enrollmentId);
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]!.amount)).toBe(1000);
    const paymentsService=app.get(ProgramPaymentService);
    await expect(paymentsService.createRefund({
      sourceKey:'recovery:invalid-refund:'+suffix,
      paymentRecordId:payments[0]!.id,
      amount:'1000.00',currencyCode:'INR',occurredAt:new Date().toISOString(),
    },userId)).rejects.toThrow('Income-reserve EMI payments require a balanced recovery reversal');
    const tokens=await prisma.$queryRawUnsafe<Array<{token:string}>>(
      'SELECT token FROM lucky_draw_tokens WHERE enrollmentId=? AND installmentId=?',enrollmentId,nextId);
    expect(tokens).toHaveLength(1);
    await financial.transaction(c=>applyInstallmentReserveOnEarning(c,{
      userId,currencyCode:'INR',amount:400,earningTransactionId:ids[0]!,now:past,
    }));
    expect(await accountBalance('USER_INSTALLMENT_RESERVE')).toBe(0);
    await earn(600,past);
    expect(await accountBalance('USER_WALLET')).toBe(2000);
    expect(await accountBalance('USER_INSTALLMENT_RESERVE')).toBe(0);
    const count=await prisma.$queryRawUnsafe<Array<{total:bigint}>>(
      "SELECT COUNT(*) total FROM installment_recovery_settlements WHERE userId=?",userId);
    expect(Number(count[0]?.total)).toBe(1);
    const beforeId=await prisma.$queryRawUnsafe<Array<{total:bigint}>>(
      'SELECT COUNT(*) total FROM installment_recovery_holds WHERE earningTransactionId=?',before);
    expect(Number(beforeId[0]?.total)).toBe(0);
  });
});
