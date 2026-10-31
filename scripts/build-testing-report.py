"""Build the customer testing report from completed, asserted test evidence."""
from pathlib import Path
import json, csv, shutil
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT/'output/testing'
reg = json.loads((EVIDENCE/'regression-results.json').read_text())
routes = json.loads((EVIDENCE/'routes-results.json').read_text())
cap = json.loads((EVIDENCE/'capacity-results.json').read_text())
assert reg['completed'] == reg['suiteCount'] == reg['passedSuites']
assert not any(r['status'] == 0 or r['status'] >= 500 for r in routes['results'])
assert all(r['pass'] for r in cap['results'])
accounts, burst, idem, drain, multi = cap['results']
for name, file in [('Segoe','segoeui.ttf'),('Bold','segoeuib.ttf')]:
    pdfmetrics.registerFont(TTFont(name, 'C:/Windows/Fonts/'+file))
ink=colors.HexColor('#162c29'); green=colors.HexColor('#16624e'); muted=colors.HexColor('#61716d')
styles={k:ParagraphStyle(k,fontName='Bold' if k in ['title','h1','h2'] else 'Segoe',fontSize=size,leading=lead,textColor=ink,spaceAfter=gap) for k,size,lead,gap in [('title',34,41,20),('h1',24,31,20),('h2',12,17,7),('body',10,15,10),('small',8.5,12,7)]}
story=[]; md=[]
def p(text,style='body'):
    story.append(Paragraph(text,styles[style])); md.append(text.replace('<b>','').replace('</b>','').replace('<br/>','\n'))
def h(text): p(text,'h2')
def page(text):
    if story: story.append(PageBreak())
    p(text,'h1')
def table(headers, rows, widths):
    data=[[Paragraph(escape(str(v)),styles['small']) for v in row] for row in [headers]+rows]
    t=Table(data,colWidths=widths,repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#edf4f0')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#dbe6e0'))]))
    story.append(t);story.append(Spacer(1,14));md.extend([' | '.join(map(str,row)) for row in [headers]+rows])

story.append(Spacer(1,66));p('Dynamo Pay','title');p('Test report<br/>&amp; merchant FAQ','title')
p('31 October 2026 • Local verification edition','h2')
p('A practical account of what was checked, what was fixed, and how the payment queue behaves. Read this alongside the Dynamo Pay Integration Manual for request examples and callback signing.')
table(['Executed check','Result'],[[f"{reg['suiteCount']} automated suites / {reg['totalTests']} tests",'PASS'],[f"{routes['total']} registered API routes; anonymous / invalid-input smoke",'PASS — no 5xx or transport failures'],['Capacity and data-integrity assertions','PASS'],['Real bank, phone app and external OAuth acceptance','Not executed in this environment']],[330,165])
p('All executed automated checks passed. This is an engineering test result for the stated environment, rather than a bank certification or a production availability guarantee.','small')

page('Fixes and regression coverage')
h('Financial operations now require administrator access')
p('Legacy ledger, settlement, split-settlement, payout and reconciliation routes accepted anonymous requests. Those internal financial routes now require the administrator token. Missing credentials and observer-only credentials are rejected. Customer integrations use their own credentials on the /v1.0 endpoints; never share the administrator token with a customer.')
h('Rate limiting follows the visitor through the local gateway')
p('The API previously grouped proxied visitors under the loopback address. It now accepts Cloudflare visitor IPs only from a loopback proxy carrying the internal service token. Direct callers cannot choose another IP by adding forwarding headers. Regression tests cover spoofed headers, independent IP windows, 429 responses and Retry-After.')
h('Payment confirmation stays tied to evidence')
p('A customer clicking Payment done or typing a UTR does not prove receipt. Missing confirmation stays pending for reconciliation. Production SMS/Gmail/Android observations are supplementary evidence. A provider confirmation or explicit owner bank review is required to mark the payment paid. Tests cover delayed credits, incorrect references, ambiguous equal-amount credits and protecting newer orders from an older merchant-confirmed receipt.')
h('Callbacks recover predictably')
p('The callback failure matrix exercises HTTP 400, 429 and 500 followed by recovery, connection refusal, signature consistency and stopping after five attempts. A background worker retries due deliveries. A timeout or callback failure does not reverse an already confirmed bank credit.')

page('Measured capacity')
p('The measurements below used an isolated SQLite database on this laptop. No money moved and no production transaction was created by these tests.')
table(['Question','Observed result'],[['How many receiving UPIs were stored?',f"{accounts['storedAccounts']:,} for one merchant; one selected as active."],['How many requests arrived together?',f"{burst['requests']} unique orders at concurrency {burst['concurrency']}; all accepted."],['How were they scheduled?',f"{burst['active']} active checkout and {burst['queued']} queued. Queued orders had no payable QR or intent."],['What happened on duplicate requests?',f"{idem['requests']} concurrent repeats returned one transaction."],['Did the queue complete?',f"{drain['confirmed']} synthetic bank confirmations; no queued orders remained."],['Can separate merchants work in parallel?',f"{multi['simultaneouslyActive']} active checkouts across {multi['merchants']} merchants; {multi['verified']} matched confirmations and no cross-merchant attribution."],['Was the database consistent?',f"Foreign-key check: {cap['foreignKeyIntegrity']}."]],[195,300])
p(f"The short order-creation burst measured {burst['requestsPerSecond']} requests/second, with p50 {burst['p50Ms']} ms, p95 {burst['p95Ms']} ms and p99 {burst['p99Ms']} ms. The benchmark raised its own rate limit to {burst['rateLimitOverriddenForBenchmark']:,}; that does not change the deployed limit.")
p('Duplicate-request handling and queue completion checks were successful. Capacity figures reflect a local test using simulated bank confirmations. See the saved technical results for the complete test conditions.','small')

page('Rate limits, callbacks and fallback')
h('How many requests per minute can one IP send?')
p('The configured default is 1,000 API requests per IP in a 60-second fixed window. Request 1,001 receives HTTP 429 and Retry-After. Status polling shares that budget. Health endpoints and paths beginning /events bypass this limiter. Counters are in memory for each process and reset on restart; a multi-process deployment needs a shared limiter.')
h('Does that mean 1,000 successful UPI payments per minute?')
p('No. Request allowance and completed payments measure different things. Real completion depends on the payer, bank, active checkout slot and authoritative provider confirmation or explicit owner bank review. The present tests establish scheduling and reconciliation behaviour, not a bank-confirmed payments-per-second maximum.')
h('What should the customer server do when a request fails?')
p('Keep the same unique order ID when retrying an uncertain creation response. Back off on 429 and honour Retry-After. Query status before starting a replacement payment. A repeated ID with a changed amount is rejected. Do not interpret a creation HTTP 200/201 as payment received.')
h('How are webhooks delivered?')
p('Dynamo Pay signs the raw JSON body with HMAC-SHA256. Verify the signature, merchant, order, amount and currency before fulfilling. Return a successful 2xx acknowledgement promptly and deduplicate delivery IDs. Delivery is attempted up to five times in total; retry delays are 5 seconds, 30 seconds, 2 minutes and 10 minutes, with the worker checking due work about every 5 seconds. Exhausted deliveries require operational review and status reconciliation.')
h('What happens when an observer or network is unavailable?')
p('Unverified UPI payments stay pending for reconciliation; they are not automatically counted as paid. The test suite covers queue/timer recovery and observation matching. Redis fallback is covered by infrastructure checks; this single-laptop run does not certify a distributed deployment. Restore the observer, compare the bank reference, amount and receiving account, and reconcile unresolved records.')

page('Merchant questions')
for question, answer in [
 ('Can I add more than one UPI?', 'Yes. Storage was tested with 1,001 accounts for one merchant. There is no certified maximum from this run. Normal routing selects one active receiving account per merchant and one active session per account. Additional stored accounts do not create automatic round-robin capacity; account switching is not a tested load-balancing strategy.'),
 ('Can I turn UPI off and set my own limits?', 'Yes. The saved channel has an enable/disable switch, a ₹200 minimum, a ₹20,000 maximum and a receiving-VPA allowlist. Tests exercise disabled channels, both amount boundaries and a blocked beneficiary. The allowlist controls the receiving UPI address, rather than the customer’s payer app.'),
 ('Will GPay open immediately?', 'Checkout exposes a UPI intent and QR. A supported phone can launch an installed payment app from the customer’s action. Browser policies, installed apps and bank support decide whether handoff succeeds. A laptop can display the QR; a physical mobile handoff was not tested here.'),
 ('Will Gmail or Android SMS mark a payment paid?', 'A connected observer submits bank-credit evidence for matching. A customer claim alone does not settle it. Gmail requires Google OAuth credentials and consent; the Android observer needs the receiving phone configured and allowed to deliver messages. Local parsers and matching flows passed; actual mailbox consent and phone delivery remain deployment checks.'),
 ('Does a refund request send money back?', 'A refund request records an operational request. It must not be described as a bank-completed refund without an actual refund rail and confirmation. Likewise, split rules and accounting entries do not prove bank payouts to beneficiaries.'),
 ('Is the wallet my bank balance?', 'No. Wallet fields represent Dynamo Pay accounting balances. Direct UPI credits do not establish a live bank-wallet balance. IFSC directory lookup is bank metadata, not account ownership verification.'),
]: h(question);p(answer)

page('Evidence and repeatable checks')
table(['Area','Evidence / command'],[['Full automated regression','node scripts/test-all.js'],['Registered-route inventory','node scripts/test-route-inventory.mjs'],['Isolated capacity / idempotency / queue','node scripts/test-capacity.mjs'],['Saved machine-readable results','output/testing/*-results.json'],['Full route list and response codes','output/testing/route-test-results.csv'],['Customer request and signature examples','Dynamo-Pay-Integration-Manual.pdf']],[210,285])
p(f"Environment: {escape(cap['environment']['node'])}, Windows, {escape(cap['environment']['cpu'])}, {cap['environment']['logicalCpus']} logical CPUs, {cap['environment']['memoryGiB']} GiB RAM. Capacity transport was HTTP loopback with isolated on-disk SQLite WAL. Test execution time: {reg['durationSeconds']} seconds for the regression runner.")
h('What the route inventory means')
p('Each of the 183 registered API routes was called once using anonymous credentials, an empty request body or a nonexistent ID. No duplicate registration, server error or timeout was found. Rejections such as 400, 401, 403 and 404 are expected successes for these negative checks. This smoke sweep does not claim a successful business transaction on every endpoint. The separate regression suites exercise supported business paths.')
h('What remains to prove in the deployment')
p('Run a controlled real receiving-bank credit, actual phone-app handoff, Gmail consent and bank-message delivery, and verify signed callback receipt on the customer server. External provider settlement, refund and payout execution need a configured rail. Long-duration load, bank throughput, Cloudflare performance, failover and multi-process scaling were not established by this local run.')
p('Keep the supplied JSON and CSV alongside this report. Re-run the commands after payment-routing or authentication changes; results describe this tested revision and environment only.','small')

def footer(c,doc):
    c.setStrokeColor(colors.HexColor('#dbe6e0'));c.line(50,48,545,48)
    c.setFont('Segoe',8);c.setFillColor(muted);c.drawString(50,32,'Dynamo Pay  /  Engineering test report  /  31 October 2026');c.drawRightString(545,32,str(doc.page))
out=ROOT/'output/pdf/Dynamo-Pay-Test-Report-and-FAQ.pdf';out.parent.mkdir(parents=True,exist_ok=True)
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),leftMargin=50,rightMargin=50,topMargin=55,bottomMargin=65,title='Dynamo Pay — Test report and merchant FAQ',author='Dynamo Pay').build(story,onFirstPage=footer,onLaterPages=footer)
(EVIDENCE/'Dynamo-Pay-Testing-and-FAQ.md').write_text('\n\n'.join(md),encoding='utf-8')
with (EVIDENCE/'route-test-results.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.writer(f);w.writerow(['Method','Path','HTTP status','Scope'])
    w.writerows((r['method'],r['path'],r['status'],r.get('mode','')) for r in routes['results'])
shutil.copyfile(out,ROOT/'apps/merchant-admin/public/dynamo-pay-testing.pdf')
shutil.copyfile(EVIDENCE/'Dynamo-Pay-Testing-and-FAQ.md',ROOT/'apps/merchant-admin/public/dynamo-testing-faq.md')
shutil.copyfile(EVIDENCE/'route-test-results.csv',ROOT/'apps/merchant-admin/public/dynamo-route-test-results.csv')
print(out)
