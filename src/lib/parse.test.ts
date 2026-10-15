import { parseSms, classify } from './parse';
import { categorize } from './categories';
import { toPaise, formatINR } from './money';

const AT = new Date(2026, 2, 5, 14, 30).getTime(); // 5 Mar 2026, 14:30 local

function parse(body: string, receivedAt: number | null = AT) {
  return parseSms(body, receivedAt);
}

// Verbatim from the device inbox, reminders and the real charges that follow them.
const SPOTIFY_DUE =
  'Dear Cardholder, your payment of INR 149.00 at Spotify India Pvt Ltd is due on 21/07/2026 and will be processed through your credit card ending 2461 as per e-Mandate (SiHub ID: XwmsBaKxO8) registered by you. To opt out of this e-Mandate, please log in to www.sbicard.com/emandates. In case, domestic Online usage on your card is inactive, please enable it by visiting https://sbicard.com/manage-card-usage to prevent any transaction decline - SBI Card';

const SPOTIFY_CHARGED =
  'Transaction of Rs.149.00 at SPOTIFYINDIA against E-mandate (SiHub ID - XwmsBaKxO8) registered by you at merchant has been debited to your SBI Credit Card ending 2461 on 21-09-26. To manage E-mandate, click: http://www.sbicard.com/emandates';

const AIRTEL_BILL = `Hi   Sahil Sadik  patel,
Bill for your Airtel Black plan for your registered number 9768957932 dated 06-Aug-2026 has been generated. Details below -

Current Month Payable Amount: Rs. 824.82 (Inclusive of tax)
Due By: 16-Aug-26

Bill Summary
This month Plan Rental: Rs. 699.00
Tax: Rs. 125.82
This Month total charges: Rs. 824.82

To view bill breakup & pay, click - https://i.airtel.in/Black_Payment`;

const AIRTEL_CHARGED = `Spent INR 824.82
Axis Bank Card no. XX8495
11-08-26 19:10:01 IST
AIRTEL PAYM
Avl Limit: INR 134988.13
Not you? SMS BLOCK 8495 to 919951860002`;

const TO_UNITY =
  'Sent Rs.50000.00 From HDFC Bank A/C *5391 To Unity Small Finance Ba On 21/09/26 Ref 625048398545';
// HDFC truncates the payee to 25 characters, so the real SMS never says "...Bank".
const TO_SURYODAY =
  'Sent Rs.50000.00 From HDFC Bank A/C *5391 To Suryoday Small Finance Ba On 20/09/26 Ref 625048398544';
const TO_AMAZON =
  'Sent Rs.13005.00 From HDFC Bank A/C *5391 To Amazon India On 12/08/26 Ref 1277736453';
const TO_CHEQ =
  'Sent Rs.42270.87 From HDFC Bank A/C *5391 To CheQ On 07/09/26 Ref 625048398545';

describe('transfers move your own money, they are not spending', () => {
  const kindOf = (body: string) => classify(body);

  it('reads a send to another bank as a transfer', () => {
    expect(kindOf(TO_UNITY)).toBe('transfer');
    expect(kindOf(TO_SURYODAY)).toBe('transfer');
  });

  it('does not mistake a merchant purchase for a transfer', () => {
    // Same "Sent Rs.X From HDFC A/C To Y" shape, but the payee is a shop.
    expect(kindOf(TO_AMAZON)).toBe('spend');
  });

  it('leaves non-bank payees alone', () => {
    expect(kindOf(TO_CHEQ)).toBe('spend');
    expect(classify('Sent Rs.15000.00 From HDFC Bank A/C *5391 To Sahil Sadik Patel On 12/08/26')).toBe(
      'spend'
    );
  });

  it('does not call a loan repayment a transfer', () => {
    expect(classify('Sent Rs.5000.00 From HDFC Bank A/C *5391 To Bajaj Finance On 03/09/26')).toBe(
      'spend'
    );
  });

  it('still parses the amount out of a transfer, so the row is complete', () => {
    const r = parse(TO_UNITY);
    expect(r.ok && r.parsed.amountPaise).toBe(5000000);
    expect(r.ok && r.parsed.kind).toBe('transfer');
  });

  it('keeps card spending on a card issuer as a spend', () => {
    expect(kindOf(AIRTEL_CHARGED)).toBe('spend');
  });
});

describe('dues are announcements, not charges', () => {
  const kindOf = (body: string) => {
    const r = parseSms(body, AT);
    return r.ok ? r.parsed.kind : `rejected:${r.reason}`;
  };

  it('marks a card e-mandate reminder as due', () => {
    expect(kindOf(SPOTIFY_DUE)).toBe('due');
  });

  it('marks a generated bill as due', () => {
    expect(kindOf(AIRTEL_BILL)).toBe('due');
  });

  it('still reads the amount and date out of a reminder, so the obligation is visible', () => {
    const r = parse(SPOTIFY_DUE);
    expect(r.ok).toBe(true);
    expect(r.ok && r.parsed.amountPaise).toBe(14900);
    expect(r.ok && r.parsed.kind).toBe('due');
  });

  it('does not swallow the real charge that follows the reminder', () => {
    expect(kindOf(SPOTIFY_CHARGED)).toBe('spend');
    expect(kindOf(AIRTEL_CHARGED)).toBe('spend');
  });

  it('treats an upcoming-mandate notice as a due', () => {
    expect(
      kindOf(
        'For the upcoming mandate set for 27-08-26, your account will be debited with Rs. 59.00 towards YouTube for the GOOGLE If mandate is paused the execution for the same will not happen. Regards, YES BANK'
      )
    ).toBe('due');
    expect(
      kindOf(
        'For the upcoming mandate set for 27-08-26, INR 59.00 will be debited from your A/c towards YouTube for GOOGLE, 620948225133. To stop execution, pause mandate - Axis Bank'
      )
    ).toBe('due');
  });

  it('keeps "has been debited" as a real charge', () => {
    expect(kindOf('Rs.149.00 has been debited to your SBI Credit Card ending 2461')).toBe('spend');
  });

  it('keeps a genuine debit that merely mentions a due date as a spend', () => {
    expect(kindOf('Rs.2500 debited towards your bill which was due on 05/03/2026 at SWIGGY')).toBe(
      'spend'
    );
  });
});

describe('money', () => {
  it('keeps paise exactly, including the float trap 1.15', () => {
    expect(toPaise('1.15')).toBe(115);
    expect(toPaise('0.1')).toBe(10);
    expect(toPaise('99.99')).toBe(9999);
  });

  it('handles Indian lakh grouping', () => {
    expect(toPaise('1,23,456.78')).toBe(12345678);
    expect(toPaise('1,00,000')).toBe(10000000);
  });

  it('rejects junk instead of returning NaN', () => {
    expect(toPaise('abc')).toBeNull();
    expect(toPaise('')).toBeNull();
    expect(toPaise('12.345')).toBeNull();
  });

  it('round-trips through the display formatter', () => {
    expect(formatINR(12345678)).toContain('1,23,456.78');
  });
});

describe('parseSms - rejects', () => {
  it.each([
    ['123456 is your OTP for login with ABC', 'otp'],
    ['Your OTP for A/c X1234 is 998877', 'otp'],
    ['Your available balance is Rs. 5,000.00', 'balance-enquiry'],
    ['Your avail bal is Rs 3200', 'balance-enquiry'],
    ['Your txn of Rs 500 has failed at ATM', 'failed-transaction'],
    ['Pre-approved loan of Rs 5,00,000. Apply now', 'promotion'],
    ['Get Rs 100 cashback. Limited period offer, 40% off', 'promotion'],
  ])('rejects %s', (body, reason) => {
    expect(parse(body)).toEqual({ ok: false, reason });
  });

  it('rejects income instead of logging it as a spend', () => {
    expect(parse('Rs. 40,000.00 credited to A/c X1234 on 03/03/2026')).toEqual({
      ok: false,
      reason: 'income',
    });
    expect(parse('INR 25,000 has been credited to your account')).toEqual({
      ok: false,
      reason: 'income',
    });
    expect(parse('Salary credited Rs 40,000')).toEqual({ ok: false, reason: 'income' });
  });

  it('rejects a debit with no parseable amount', () => {
    expect(parse('Your card was debited today')).toEqual({ ok: false, reason: 'no-amount' });
  });

  it('reads income as income even when it names the outgoing payment first', () => {
    // "payment of" only names a payment; nothing says money left the account.
    expect(parse('Payment of Rs 500 has been received from Zomato')).toEqual({
      ok: false,
      reason: 'income',
    });
    expect(parse('Purchase of Rs 1200 credited to your account by Amazon')).toEqual({
      ok: false,
      reason: 'income',
    });
  });
});

describe('parseSms - accepts spends', () => {
  it('reads HDFC-style debit with avl bal', () => {
    const r = parse('Rs.500.00 debited from A/c X1234 on 05/03/2026 avl bal Rs.4,500.00');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.amountPaise).toBe(50000);
    expect(r.parsed.direction).toBe('debit');
  });

  it('reads UPI spend and pulls the merchant out', () => {
    const r = parse('INR 250.50 debited for SWIGGY ORDER via UPI on 05-03-2026');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.amountPaise).toBe(25050);
    expect(r.parsed.merchant?.toUpperCase()).toContain('SWIGGY');
  });

  it('reads amount-suffix form "5000 INR debited"', () => {
    const r = parse('5000 INR debited from your account on 10-Mar-2026');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.amountPaise).toBe(500000);
  });

  it('reads a large lakh amount without losing paise', () => {
    const r = parse('Rs 1,23,456.78 spent on UPI at BIG BAZAAR on 05/03/2026');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.amountPaise).toBe(12345678);
  });

  it('prefers the platform timestamp over the in-body date', () => {
    const r = parse('Rs.250 spent at CAFE on 01/01/2001');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.txnAt).toBe(AT);
  });

  it('falls back to the in-body date when there is no timestamp (pasted SMS)', () => {
    const r = parseSms('Rs.250 spent at CAFE on 14/02/2026', null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new Date(r.parsed.txnAt).getDate()).toBe(14);
    expect(new Date(r.parsed.txnAt).getMonth()).toBe(1);
  });

  it('expands a 2-digit year', () => {
    const r = parseSms('Rs.250 spent at CAFE on 14/02/26', null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new Date(r.parsed.txnAt).getFullYear()).toBe(2026);
  });

  it('leaves merchant null rather than guessing', () => {
    const r = parse('Rs.900 debited from A/c X1234 avl bal Rs.100');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.merchant).toBeNull();
  });

  it('treats "debited ... cashback credited" as a debit (a strong debit beats a rebate)', () => {
    const r = parse('Rs 500 debited at SWIGGY, Rs 50 cashback credited');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.direction).toBe('debit');
  });

  it('still logs a spend that only a weak debit word describes', () => {
    const r = parse('Rs 500 paid to SWIGGY on 05/03/2026');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.direction).toBe('debit');
  });

  it('keeps a refunded spend as a spend', () => {
    const r = parse('Rs 900 paid to SWIGGY and later refunded on 05/03/2026');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.direction).toBe('debit');
  });

  it('reads the HDFC multi-line "Sent Rs.40.00" UPI format', () => {
    const r = parse(
      'Sent Rs.40.00 From HDFC Bank A/C *5391 To KARTIK STORE NEW On 10/10/26 Ref 664943010376 ' +
        'Not You? Call 18002586161/SMS BLOCK UPI to 7308080808'
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.amountPaise).toBe(4000);
    expect(r.parsed.merchant).toBe('KARTIK STORE NEW');
    expect(r.parsed.direction).toBe('debit');
  });

  it('still treats cashback sent as income, not a spend', () => {
    expect(parse('Rs 50 cashback sent to your account')).toEqual({ ok: false, reason: 'income' });
  });

  // Verbatim from the device inbox. It was the only real message in 90 days that no
  // amount rule could read: SBI writes a bare number after "debited by", under the
  // three-digit floor that keeps reference numbers out of the amount column.
  const SBI_UPI =
    'Dear UPI user A/C X2656 debited by 1.00 on date 12Oct26 trf to sahillovehater-3 ' +
    'Refno 628502247435 If not u? call-1800111109 for other services-18001234-SBI';

  it('reads the SBI UPI amount written bare after "debited by"', () => {
    const r = parse(SBI_UPI);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.amountPaise).toBe(100);
    expect(r.parsed.direction).toBe('debit');
    expect(r.parsed.kind).toBe('spend');
  });

  it('stops the merchant at "Refno" rather than the helpline below it', () => {
    const r = parse(SBI_UPI);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The old rule read "other services-18001234-", scraped from the wrong clause.
    expect(r.parsed.merchant).toBe('sahillovehater-3');
  });

  it('still refuses to read a reference number or helpline as an amount', () => {
    expect(parse('Refno 628502247435 has been debited to your account')).toEqual({
      ok: false,
      reason: 'no-amount',
    });
  });

  it('still refuses a bare whole number under Rs 100, which needs the decimal to count', () => {
    expect(parse('Rs paid for 3 items on 05/03/2026')).toEqual({ ok: false, reason: 'no-amount' });
  });

  it.each([
    ['Sent Rs.249.00 From HDFC Bank A/C *5391 To SWIGGY ORDER On 10/10/26 Ref 664943', 'Swiggy'],
    ['Sent Rs.249.00 From HDFC Bank A/C *5391 To ZOMATO ORDER On 10/10/26 Ref 664943', 'Zomato'],
    ['Sent Rs.249.00 From HDFC Bank A/C *5391 To ZEPTO On 10/10/26 Ref 664943', 'Zepto'],
    ['Sent Rs.249.00 From HDFC Bank A/C *5391 To BLINKIT On 10/10/26 Ref 664943', 'Blinkit'],
    ['Sent Rs.249.00 From HDFC Bank A/C *5391 To SWIGGY INSTAMART On 10/10/26 Ref 664943', 'Instamart'],
  ])('names %s as a merchant', (body, expected) => {
    const r = parse(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.merchant).toBe(expected);
  });

  it('names a brand from a message with no at/to scrape at all', () => {
    const r = parse('Rs 499 charged for your Swiggy Instamart order via UPI Ref 88123');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.merchant).toBe('Instamart');
  });

  it('logs a payment that is due as a spend', () => {
    const emi = parse('Your EMI of Rs 25000 is due on 05 Nov');
    expect(emi.ok).toBe(true);
    if (emi.ok) {
      expect(emi.parsed.amountPaise).toBe(2500000);
      expect(emi.parsed.direction).toBe('debit');
    }

    const bank = parse('Your Bank no. XX8495 payment is due of Rs 5,032.34');
    expect(bank.ok).toBe(true);
    if (bank.ok) expect(bank.parsed.amountPaise).toBe(503234);
  });

  it('still ignores a balance owed back to you', () => {
    expect(parse('Balance due Rs 500.00')).toEqual({ ok: false, reason: 'balance-enquiry' });
  });
});

describe('categorize', () => {
  it.each([
    ['SWIGGY ORDER', 'Food'],
    ['Zomato', 'Food'],
    ['Uber India', 'Transport'],
    ['AMAZON', 'Shopping'],
    ['Airtel recharge', 'Bills'],
    ['Apollo Pharmacy', 'Health'],
    ['BookMyShow PVR', 'Entertainment'],
    ['KARTIK STORE NEW', 'Groceries'],
    ['Instamart', 'Groceries'],
    ['Zepto', 'Groceries'],
    ['Blinkit', 'Groceries'],
    ['SHREE GENERAL STORE', 'Groceries'],
    ['Some Unknown Place', 'Other'],
  ])('maps %s to %s', (merchant, expected) => {
    expect(categorize(merchant)).toBe(expected);
  });
});