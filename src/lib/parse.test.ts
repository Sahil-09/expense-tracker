import { parseSms, classify, parseBalance } from './parse';
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

  // Verbatim from the device inbox. Axis writes the statement as "is generated" (not
  // "has been generated") and the total as "INR  Dr. 13436.07" — currency, then the debit
  // marker, then the number. Both fixes must stay together: the amount rule alone would
  // have made this a ₹13,436 spend.
  const AXIS_STATEMENT = `Your statement for Axis Bank Credit Card no. XX8495 is generated.
Due on: 09-11-26
Total amt: INR  Dr. 13436.07
Min amt due: INR  Dr. 269.00
Pay at axis.bank.in/ccpaynow
To view fees & charges: axis.bank.in/kfs`;

  it('marks an Axis card statement as due, for the total not the minimum', () => {
    const r = parse(AXIS_STATEMENT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.kind).toBe('due');
    expect(r.parsed.amountPaise).toBe(1343607);
  });

  // Verbatim from the device inbox. Nothing in it matches the older reminder wording
  // ("is due on", "bill generated"), and "If not received" reads as a credit, so the
  // statement used to store as income. The "amount due"/"payable by" wording is what
  // marks it as a due.
  const SBI_STATEMENT =
    'E-statement of SBI Credit Card ending XX61 dated 12/10/2026 has been mailed. If not ' +
    'received, SMS ENRS to 5676791. Total Amt Due Rs 149; Min Amt Due Rs 149; Payable by ' +
    '01/11/2026. Click https://sbicard.com/quickpaynet to pay your bill';

  it('marks an SBI e-statement reminder as due, not income', () => {
    const r = parse(SBI_STATEMENT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.kind).toBe('due');
    expect(r.parsed.amountPaise).toBe(14900);
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

  it('stores income as income, not as a spend', () => {
    for (const body of [
      'Rs. 40,000.00 credited to A/c X1234 on 03/03/2026',
      'INR 25,000 has been credited to your account',
      'Salary credited Rs 40,000',
    ]) {
      const r = parse(body);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.parsed.kind).toBe('income');
    }
  });

  it('rejects a debit with no parseable amount', () => {
    expect(parse('Your card was debited today')).toEqual({ ok: false, reason: 'no-amount' });
  });

  it('reads income as income even when it names the outgoing payment first', () => {
    // "payment of" only names a payment; nothing says money left the account.
    for (const body of [
      'Payment of Rs 500 has been received from Zomato',
      'Purchase of Rs 1200 credited to your account by Amazon',
    ]) {
      const r = parse(body);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.parsed.kind).toBe('income');
    }
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

  // Verbatim from the device inbox. Canara writes the debit as "Dr." and puts the UPI
  // reference behind a semicolon, so both the direction and the merchant had to be taught.
  const CANARA =
    '[AD-CANBNK-S] Dear Customer, Acct XXXX9649 Dr. INR 1,680.00 on 11/10/26 to Famous Chick; ' +
    'UPI: 131090294863; Bal INR 1,86,417.20.Not you?SMS BLOCKUPI to 9901771222-CanaraBank';

  it('reads the Canara "Dr." debit and the merchant behind the semicolon', () => {
    const r = parse(CANARA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.amountPaise).toBe(168000);
    expect(r.parsed.direction).toBe('debit');
    expect(r.parsed.merchant).toBe('Famous Chick');
    expect(r.parsed.kind).toBe('spend');
  });

  it('reads a Canara credit as income', () => {
    const r = parse(
      'Dear Customer, Acct XXXX9649 Cr. INR 500.00 on 11/10/26 from Rahul Sharma; UPI: 131090294863'
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.kind).toBe('income');
      expect(r.parsed.direction).toBe('credit');
    }
  });

  it('does not read a doctor as a debit', () => {
    // "Dr." is also a title. Only "Dr." followed by an amount is a bank debit.
    expect(parse("Dr. Smith's clinic confirmed for 11/10/2026")).toEqual({
      ok: false,
      reason: 'no-direction',
    });
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
    const r = parse('Rs 50 cashback sent to your account');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.parsed.kind).toBe('income');
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

/**
 * The HDFC salary credit, verbatim. Three things in it used to break the parser: the
 * title is styled in mathematical letters, "Rs. INR" stacks two currency words, and
 * the running balance at the end is the larger of the two numbers.
 */
const HDFC_SALARY =
  '\u{1F4E9} \u{1D412}\u{1D41A}\u{1D425}\u{1D41A}\u{1D42B}\u{1D432} \u{1D402}\u{1D42B}\u{1D41E}\u{1D41D}\u{1D422}\u{1D42D}\u{1D41E}\u{1D41D}! ' +
  'Rs. INR 15,311.00 credited to your HDFC Bank A/c XX5391. Avl bal: INR 1,30,477.87';

describe('a salary credit is income, and its balance is not the amount', () => {
  it('reads the credit amount, not the balance that follows it', () => {
    const r = parse(HDFC_SALARY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.kind).toBe('income');
    expect(r.parsed.direction).toBe('credit');
    expect(r.parsed.amountPaise).toBe(1531100);
  });

  it('reads a credit whose only keyword is styled in mathematical letters', () => {
    // The same message with the body keyword replaced by the styled one, so the
    // direction can only come from the title.
    const styled =
      '\u{1D412}\u{1D41A}\u{1D425}\u{1D41A}\u{1D42B}\u{1D432} \u{1D402}\u{1D42B}\u{1D41E}\u{1D41D}\u{1D422}\u{1D42D}\u{1D41E}\u{1D41D}! ' +
      'Rs. INR 15,311.00 to your HDFC Bank A/c XX5391. Avl bal: INR 1,30,477.87';
    const r = parse(styled);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.kind).toBe('income');
    expect(r.parsed.amountPaise).toBe(1531100);
  });

  it('is still a credit when the balance is spelled out in full', () => {
    const r = parse(
      'Rs. INR 15,311.00 credited to your HDFC Bank A/c XX5391. Available balance: INR 1,30,477.87'
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.kind).toBe('income');
    expect(r.parsed.amountPaise).toBe(1531100);
  });

  it('keeps a spend a spend when it also quotes the balance', () => {
    for (const body of [
      'Rs.500 debited at SWIGGY on 21/10/2026. Avl bal: INR 1,30,477.87',
      'Rs.500 debited at SWIGGY on 21/10/2026. Available balance: INR 1,30,477.87',
    ]) {
      const r = parse(body);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.parsed.kind).toBe('spend');
      expect(r.parsed.amountPaise).toBe(50000);
    }
  });
});

describe('parseBalance', () => {
  it('reads the balance and the account a message names', () => {
    expect(parseBalance(HDFC_SALARY)).toEqual({
      account: 'HDFC XX5391',
      amountPaise: 13047787,
    });
  });

  it('reads a balance-only message, which the transaction rules skip', () => {
    const body = 'Avl bal: INR 1,30,477.87 on your HDFC Bank A/c XX5391';
    expect(parse(body)).toEqual({ ok: false, reason: 'balance-enquiry' });
    expect(parseBalance(body)).toEqual({ account: 'HDFC XX5391', amountPaise: 13047787 });
  });

  it('has nothing to say about a message that quotes no balance', () => {
    expect(parseBalance('Rs.500 debited at SWIGGY on 21/10/2026')).toBeNull();
  });

  it('does not read a credit limit as a balance', () => {
    expect(
      parseBalance('Spent INR 824.82\nAxis Bank Card no. XX8495\nAvl Limit: INR 134988.13')
    ).toBeNull();
  });

  it('reads the balance however the bank words it', () => {
    for (const [body, amountPaise] of [
      ['Bal: INR 500 on your HDFC Bank A/c XX5391', 50000],
      ['Total balance INR 90 on your HDFC Bank A/c XX5391', 9000],
      ['Closing balance INR 90 on your HDFC Bank A/c XX5391', 9000],
      ['Avl bal INR 90 on your HDFC Bank A/c XX5391', 9000],
    ] as const) {
      expect(parseBalance(body)).toEqual({ account: 'HDFC XX5391', amountPaise });
    }
  });

  it('does not log a balance-only message as a spend', () => {
    for (const body of [
      'Bal: INR 500 on your HDFC Bank A/c XX5391',
      'Total balance INR 90 on your HDFC Bank A/c XX5391',
      'Closing balance INR 90 on your HDFC Bank A/c XX5391',
    ]) {
      expect(parse(body).ok).toBe(false);
    }
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