# ESR Extracted Fields Path Report (Case 60)

## Section: GST

ESR Field: gst_latest_fy_turnover
Final DB/Snapshot Field: gst_requests.turnover_latest_year / case_esr_financials.gst_avg_monthly_sales source
Source Type: GST_JSON
Exact Source Path: data[].Overview_Monthly.Business Breakup.Sales[] or Total Value of Sales (A)
Raw Value Picked:
Rows Included:
Apr 2025: ₹4,32,610
May 2025: ₹5,28,612.09
Jun 2025: ₹91,450
Jul 2025: ₹5,94,583.33
Aug 2025: ₹4,98,202
Sep 2025: ₹9,32,973.33
Oct 2025: ₹9,65,760
Nov 2025: ₹2,78,760
Dec 2025: ₹12,74,014
Jan 2026: ₹12,40,117
Feb 2026: ₹4,65,663
Mar 2026: ₹9,67,515
Normalized Value: XXXX2400.99
Formula: Sum latest FY monthly sales rows
Used In Method: GST
Ignored Alternative Fields:
- Month Year = Total row
- Multi-year aggregate row
Reason for Ignoring:
Ignored because latest FY only should be used.

---

ESR Field: gst_industry_margin
Source Type: LENDER_CONFIG or GST_JSON industry mapping
Exact Source Path: Config Key: gst_industry_margin
Normalized Value: 0.15
Formula: gst_income = gst_avg_monthly_sales × gst_industry_margin

---

## Section: Bank ABB Sampling

ESR Field: Balance 5th (Apr 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Apr 2025"].amount
Raw Value Picked:
11051.59
Normalized Value: 11051.59
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Apr 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Apr 2025"].amount
Raw Value Picked:
212127.59
Normalized Value: 212127.59
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Apr 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Apr 2025"].amount
Raw Value Picked:
210897.59
Normalized Value: 210897.59
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Apr 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Apr 2025"].amount
Raw Value Picked:
636649.81
Normalized Value: 636649.81
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (May 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="May 2025"].amount
Raw Value Picked:
151389.71
Normalized Value: 151389.71
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (May 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="May 2025"].amount
Raw Value Picked:
134877.47
Normalized Value: 134877.47
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (May 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="May 2025"].amount
Raw Value Picked:
430856.97
Normalized Value: 430856.97
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (May 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="May 2025"].amount
Raw Value Picked:
411372.97
Normalized Value: 411372.97
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Jun 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Jun 2025"].amount
Raw Value Picked:
21949.97
Normalized Value: 21949.97
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Jun 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Jun 2025"].amount
Raw Value Picked:
86683.97
Normalized Value: 86683.97
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Jun 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Jun 2025"].amount
Raw Value Picked:
77148.97
Normalized Value: 77148.97
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Jun 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Jun 2025"].amount
Raw Value Picked:
276818.47
Normalized Value: 276818.47
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Jul 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Jul 2025"].amount
Raw Value Picked:
163725.65
Normalized Value: 163725.65
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Jul 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Jul 2025"].amount
Raw Value Picked:
99261.39
Normalized Value: 99261.39
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Jul 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Jul 2025"].amount
Raw Value Picked:
93361.39
Normalized Value: 93361.39
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Jul 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Jul 2025"].amount
Raw Value Picked:
359227.71
Normalized Value: 359227.71
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Aug 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Aug 2025"].amount
Raw Value Picked:
167025.47
Normalized Value: 167025.47
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Aug 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Aug 2025"].amount
Raw Value Picked:
272313.47
Normalized Value: 272313.47
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Aug 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Aug 2025"].amount
Raw Value Picked:
137479.47
Normalized Value: 137479.47
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Aug 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Aug 2025"].amount
Raw Value Picked:
680502.29
Normalized Value: 680502.29
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Sep 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Sep 2025"].amount
Raw Value Picked:
528247.29
Normalized Value: 528247.29
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Sep 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Sep 2025"].amount
Raw Value Picked:
455007.29
Normalized Value: 455007.29
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Sep 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Sep 2025"].amount
Raw Value Picked:
581732.57
Normalized Value: 581732.57
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Sep 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Sep 2025"].amount
Raw Value Picked:
811732.37
Normalized Value: 811732.37
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Oct 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Oct 2025"].amount
Raw Value Picked:
346097.37
Normalized Value: 346097.37
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Oct 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Oct 2025"].amount
Raw Value Picked:
296696.55
Normalized Value: 296696.55
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Oct 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Oct 2025"].amount
Raw Value Picked:
469114.91
Normalized Value: 469114.91
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Oct 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Oct 2025"].amount
Raw Value Picked:
362787.91
Normalized Value: 362787.91
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Nov 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Nov 2025"].amount
Raw Value Picked:
79957.99
Normalized Value: 79957.99
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Nov 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Nov 2025"].amount
Raw Value Picked:
147157.99
Normalized Value: 147157.99
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Nov 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Nov 2025"].amount
Raw Value Picked:
78752.99
Normalized Value: 78752.99
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Nov 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Nov 2025"].amount
Raw Value Picked:
121073.37
Normalized Value: 121073.37
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Dec 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Dec 2025"].amount
Raw Value Picked:
160453.37
Normalized Value: 160453.37
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Dec 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Dec 2025"].amount
Raw Value Picked:
45153.37
Normalized Value: 45153.37
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Dec 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Dec 2025"].amount
Raw Value Picked:
315353.37
Normalized Value: 315353.37
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Dec 2025)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Dec 2025"].amount
Raw Value Picked:
638367.77
Normalized Value: 638367.77
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Jan 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Jan 2026"].amount
Raw Value Picked:
317062.77
Normalized Value: 317062.77
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Jan 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Jan 2026"].amount
Raw Value Picked:
295262.77
Normalized Value: 295262.77
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Jan 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Jan 2026"].amount
Raw Value Picked:
607142.77
Normalized Value: 607142.77
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Jan 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Jan 2026"].amount
Raw Value Picked:
358235.01
Normalized Value: 358235.01
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Feb 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Feb 2026"].amount
Raw Value Picked:
188435.01
Normalized Value: 188435.01
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Feb 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Feb 2026"].amount
Raw Value Picked:
116435.01
Normalized Value: 116435.01
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Feb 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Feb 2026"].amount
Raw Value Picked:
119753.93
Normalized Value: 119753.93
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Feb 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Feb 2026"].amount
Raw Value Picked:
92630.93
Normalized Value: 92630.93
Used In Method: Monthly ABB

---

ESR Field: Balance 5th (Mar 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["5"][month="Mar 2026"].amount
Raw Value Picked:
145335.87
Normalized Value: 145335.87
Used In Method: Monthly ABB

---

ESR Field: Balance 10th (Mar 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["10"][month="Mar 2026"].amount
Raw Value Picked:
612496.09
Normalized Value: 612496.09
Used In Method: Monthly ABB

---

ESR Field: Balance 15th (Mar 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["15"][month="Mar 2026"].amount
Raw Value Picked:
53442.09
Normalized Value: 53442.09
Used In Method: Monthly ABB

---

ESR Field: Balance 25th (Mar 2026)
Source Type: BANK_JSON
Exact Source Path: dailyBalance.day["25"][month="Mar 2026"].amount
Raw Value Picked:
540047.27
Normalized Value: 540047.27
Used In Method: Monthly ABB

---

## Section: Bank Formulas

ESR Field: bank_avg_balance
Final DB/Snapshot Field: case_esr_financials.bank_avg_balance
Source Type: 
Normalized Value: 281639.XXXXXX6667
Formula: average(monthly ABB values across valid months)
Notes:
Vendor averageDailyBalance was ignored because client Excel requires 5/10/15/25 daily balance method.

---

ESR Field: banking_income
Final DB/Snapshot Field: case_esr_financials.banking_income
Source Type: 
Normalized Value: 563278.XXXXXX3333
Formula: final ABB × banking_abb_multiplier

---

## Section: Bank Credit

ESR Field: bank_avg_monthly_credit
Final DB/Snapshot Field: case_esr_financials.bank_avg_monthly_credit
Source Type: BANK_JSON
Exact Source Path: summary.dataDeposits.Deposits
Normalized Value: 1123551.XXXXX6667
Formula: Annual deposits / 12
Ignored Alternative Fields:
- Interest
- I/W Funds Transfer
- Transfer From Self
Reason for Ignoring:
Ignored because parent Deposits already includes child categories.

---

## Section: Salaried

ESR Field: salaried_income
Source Type: BANK_JSON / OCR / FRONTEND_MANUAL
Exact Source Path: salary.salary[]
Included In Selected Monthly Income: No
Reason for Ignoring:
NO_VALID_SALARIED_INCOME_SOURCE
Notes:
Total Salary Entries Checked. CR/Inward Entries Used. DB/Debit Entries Ignored (Debit salary entries are payroll expenses, not borrower salary income).

---

