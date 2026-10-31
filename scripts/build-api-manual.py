from pathlib import Path
from xml.sax.saxutils import escape
import shutil
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Preformatted
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf/Dynamo-Pay-Integration-Manual.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
for name,file in [('Segoe','segoeui.ttf'),('SegoeBold','segoeuib.ttf'),('Mono','consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
NAVY=colors.HexColor('#162c29'); VIOLET=colors.HexColor('#16624e'); MUTED=colors.HexColor('#61716d'); LINE=colors.HexColor('#dbe6e0')
styles={
 'title':ParagraphStyle('title',fontName='SegoeBold',fontSize=35,leading=43,textColor=NAVY,spaceAfter=20),
 'h1':ParagraphStyle('h1',fontName='SegoeBold',fontSize=23,leading=29,textColor=NAVY,spaceAfter=18),
 'h2':ParagraphStyle('h2',fontName='SegoeBold',fontSize=12.5,leading=18,textColor=NAVY,spaceBefore=11,spaceAfter=6),
 'body':ParagraphStyle('body',fontName='Segoe',fontSize=9.6,leading=14,textColor=NAVY,spaceAfter=8),
 'small':ParagraphStyle('small',fontName='Segoe',fontSize=8.4,leading=12,textColor=MUTED,spaceAfter=8),
 'code':ParagraphStyle('code',fontName='Mono',fontSize=8,leading=11,textColor=NAVY,backColor=colors.HexColor('#f3f4fa'),borderPadding=10,spaceBefore=7,spaceAfter=14),
}
story=[]
def p(text,style='body'):story.append(Paragraph(text,styles[style]))
def h(text):p(text,'h2')
def code(text):story.append(Preformatted(text,styles['code']))
def page(title):
    if story:story.append(PageBreak())
    p(title,'h1')
def table(headers,rows,widths):
    data=[[Paragraph(escape(str(x)),styles['small']) for x in headers]]+[[Paragraph(escape(str(x)),styles['small']) for x in row] for row in rows]
    t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eef0fb')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,0),(-1,-1),.5,LINE)]))
    story.append(t);story.append(Spacer(1,12))

story.append(Spacer(1,65))
p('Dynamo Pay','title')
p('Merchant &amp; API<br/>User manual','title')
p('Your guide to collecting and managing UPI payments','h2')
p('Set up your account, connect your website, and manage payments from the Dynamo Pay Merchant Console. Each section explains the action to take and the result to expect.')
story.append(Spacer(1,22))
p('Version 1.1  |  31 October 2026','small')
h('Before you begin')
p('Have your gateway address, merchant credentials and receiving UPI ID ready. Your private account handover contains the access details. You can also find your integration credentials under <b>Developer tools</b> in the console.')
p('Use this manual with your development team. The separate private credential sheet is for the account owner and authorised server administrators.','small')
h('What you will find inside')
p('2  Setup and authentication<br/>3  Create a UPI payment<br/>4  Follow the payment status<br/>5  Receive and verify callbacks<br/>6  IFSC lookup and wallet balances<br/>7  UPI controls and reconciliation<br/>8  Daily operations and troubleshooting<br/>9  Credentials and account access<br/>10  Successful checks and common questions')

page('Setup and authentication')
p('Your backend talks to Dynamo Pay. Your customer opens the checkout page returned by the API. Keep that separation: API secrets belong on your server, never in browser JavaScript or a mobile app bundle.')
h('Your gateway address')
code('DYNAMO_BASE_URL=https://your-assigned-gateway.example')
p('Use the HTTPS origin supplied for your deployment. A temporary tunnel address changes when the tunnel restarts. Give customers a fixed HTTPS domain for ongoing integrations.')
h('Send these headers on every API request')
table(['Header','What to send'],[['Client-ID','Your Dynamo Pay client ID'],['Client-Secret','Your backend client secret'],['Service-Id','Your assigned merchant service ID'],['Content-Type','application/json']],[145,350])
p('Use the same Service-Id for your own collection, status, IFSC and wallet requests. Do not copy service IDs from somebody else\'s examples.')
h('Available endpoints')
table(['Function','Method','Endpoint'],[['Create UPI payment','POST','/v1.0/collect/upi'],['Check status','POST','/v1.0/payin/checkstatus'],['Look up IFSC','POST','/v1.0/ifsc/{ifsc}'],['Read wallet balances','POST','/v1.0/wallet'],['Save callback / IP list','POST','/v1.0/merchant/webhook']],[133,55,307])
h('Server IP restrictions')
p('You can allow only specific server IPs to use your credentials. Enter your backend\'s public outbound IP address, not your laptop\'s private address. Exact IPv4 and IPv6 addresses are supported; CIDR ranges are not. An empty list leaves IP restriction off.')
p('The receiving-UPI allowlist is a separate setting. It controls where payments go, rather than which server can call the API.','small')

page('Create a UPI payment')
p('Create one transaction ID for each merchant order and save it in your database before making the request. This gives you a reliable way to check the result if your connection drops.')
code('POST /v1.0/collect/upi\n\n{\n  "amount": "201.00",\n  "uniquetransactionid": "ORDER-1001",\n  "remarks": "Digital service",\n  "name": "Customer name",\n  "emailid": "customer@example.com",\n  "mobileno": "9876543210"\n}')
p('<b>Required:</b> amount and uniquetransactionid. The transaction ID accepts 1-120 letters, digits, hyphens or underscores. Customer details and remarks are optional.')
p('Send amounts in rupees with no more than two decimal places. With the current merchant settings, new UPI payments must be between <b>INR 200.00 and INR 20,000.00</b>. These limits can be changed in the console. The versioned API itself has a floor of INR 100.00; the higher configured minimum takes precedence.')
h('What comes back')
code('{\n  "transaction": "payment-uuid",\n  "uniquetransactionid": "ORDER-1001",\n  "amount": "201.00",\n  "currency": "INR",\n  "status": "PENDING",\n  "internalStatus": "ACTIVE",\n  "checkoutUrl": "https://your-gateway/checkout/payment-uuid",\n  "qr": "https://your-gateway/checkout/payment-uuid/qr.svg",\n  "intent": "upi://pay?pa=merchant%40bank&am=201.00&cu=INR"\n}')
p('This response is shortened for readability. It also includes creation time, expiry when available and payee details. Examples in this manual are illustrative.','small')
p('Redirect the customer to <b>checkoutUrl</b>. It opens the Dynamo Pay QR and UPI app choices directly. The qr field is an SVG image URL; intent is a UPI app link. For queued payments both are null until activation. Never display an old or expired QR.')
p('<b>A successful API request creates an order. It does not mean the customer has paid.</b>')

page('Follow the payment status')
code('POST /v1.0/payin/checkstatus\n\n{ "uniquetransactionid": "ORDER-1001" }')
p('You can also send <b>transaction</b> with the payment UUID. Use your merchant credentials; you cannot query another merchant\'s payment.')
table(['Public status','What it means','What your app should do'],[['PENDING','Payment is queued, active, being checked or awaiting bank verification.','Keep the order unpaid. Show a clear waiting message.'],['SUCCESS','Receipt has been confirmed.','Verify order, amount, currency and method before fulfilment.'],['FAILED','Payment failed, expired or was cancelled.','Show the specific outcome from internalStatus. Avoid asking a debited customer to pay again.']],[90,198,207])
h('When a customer taps Payment done')
p('Dynamo Pay starts checking for a matching bank notification. The button itself does not prove receipt. If the notification has not arrived when the short verification timer ends, the order stays <b>VERIFICATION_PENDING</b>, not automatically failed.')
p('A customer can save or correct the 12-digit UPI reference while waiting. This is a reported reference, not proof. A matching bank record is still needed for automatic confirmation. Poll status no faster than once every five seconds and stop at a final result.')
h('Know the source of confirmation')
p('<b>confirmationSource</b> identifies BANK_OBSERVER or MERCHANT when available. A merchant-confirmed receipt is recorded separately from automatic bank verification. Missing bank references remain null; a typed reportedUtr is never presented as a verified bank reference.')
h('Repeat requests safely')
p('The same transaction ID and amount returns the existing order with HTTP 200. A new order returns HTTP 201. Reusing an ID with a different amount returns HTTP 409. If a request times out, retry with the same ID rather than creating another charge.')
p('A final order keeps its ID. If the customer deliberately starts a new attempt, use a new merchant transaction ID. The normal active checkout window is five minutes after activation; time in the queue is separate.')

page('Receive and verify callbacks')
p('Give Dynamo Pay a public HTTPS URL on your server. When a payment reaches a final outcome, Dynamo Pay sends a JSON POST to that URL. Save the event reliably, process it once and return HTTP 200.')
code('POST /v1.0/merchant/webhook\n\n{\n  "webhookUrl": "https://your-store.example/payment-callback",\n  "ipWhitelist": ["203.0.113.10"]\n}')
p('The IP above is an example. Replace it with your server\'s actual public IP, or omit the field to keep the existing list.','small')
h('Check the signature before reading the event')
p('The X-Gateway-Signature header contains sha256= followed by an HMAC-SHA256 digest. Calculate that digest from the <b>original request bytes</b>, using your webhook signing secret. Compare it in constant time. Do not parse and re-serialize JSON before checking it.')
code("import crypto from 'node:crypto';\n\nconst expected = 'sha256=' + crypto\n  .createHmac('sha256', process.env.DYNAMO_WEBHOOK_SECRET)\n  .update(rawBody)\n  .digest('hex');\nconst supplied = String(req.headers['x-gateway-signature'] || '');\nconst valid = supplied.length === expected.length &&\n  crypto.timingSafeEqual(Buffer.from(supplied),\n                         Buffer.from(expected));\nif (!valid) { res.statusCode = 401; res.end(); return; }\nconst event = JSON.parse(rawBody.toString('utf8'));\n// Validate, deduplicate and persist before acknowledging.\nres.statusCode = 200;\nres.end('OK');")
h('Check the business details too')
p('Match orderId, amountPaise, INR currency and payment method to your stored order. Only fulfil prepaid goods for a verified, eligible SUCCESS event. COD SUCCESS means an order was placed; cash has not been collected yet. Deduplicate X-Gateway-Delivery-Id and protect fulfilment with your own unique order constraint.')
p('Callbacks include event, status, transaction/paymentId, uniquetransactionid/orderId, amount, amountPaise, currency, method, bankReferenceNumber/utr, senderVpa, payeeVpa, beneficiary, confirmationSource, completedAt and metadata. Fields without verified data can be null.','small')

page('IFSC lookup and wallet balances')
h('Look up an IFSC code')
code('POST /v1.0/ifsc/SBIN0000001\nContent-Type: application/json\n\n{}')
p('Send the same three authentication headers. An IFSC has four letters, a zero and six letters or digits. The response describes the bank and branch, including city, state, address, contact and supported payment networks.')
code('{\n  "ifsc": "SBIN0000001",\n  "bank": "Bank name",\n  "branch": "Branch name",\n  "city": "City",\n  "upi": true,\n  "neft": true,\n  "rtgs": true,\n  "imps": true\n}')
p('This is a bank-directory lookup, not account ownership verification or a promise that a transfer will work. The directory is external. A lookup failure alone is not enough to declare a customer\'s bank account invalid.')
h('Read the merchant wallet')
code('POST /v1.0/wallet\nContent-Type: application/json\n\n{}')
table(['Field','Meaning'],[['settledwallet','Settled amount recorded in the ledger.'],['unsettledbalance','Collections recorded as not yet settled.'],['lienbalance','Amount held or in transit for payouts.'],['loanbalance','Loan balance represented by the ledger.']],[165,330])
p('All four balances are decimal INR strings, for example "1250.00". The response also identifies the merchant, currency and response time.')
p('<b>These are accounting balances, not a live bank-balance enquiry.</b> A direct UPI credit to your bank does not automatically become money in a provider wallet. Reconcile bank and ledger records before making settlement decisions.')

page('UPI controls and reconciliation')
p('Open <b>Merchant Console &gt; UPI Accounts</b> to manage the channel. Save changes when you are ready to apply them to new payment requests.')
table(['Control','How it works'],[['Enable UPI payments','On accepts new UPI requests. Off rejects new requests. Existing payments can still be checked and reconciled.'],['Minimum amount','Currently INR 200.00. Requests below the saved minimum are rejected.'],['Maximum amount','Currently INR 20,000.00. Requests above the saved maximum are rejected.'],['Allowed receiving UPI IDs','Only these beneficiary IDs can receive new collections. This is not a list of customer payer IDs.']],[153,342])
p('Separate allowed receiving IDs with commas or new lines. Leave the list empty to allow any receiving account configured for your merchant. Check the active receiving account before adding restrictions, or you may block your own collections.')
h('Connect a bank confirmation channel')
p('<b>Android SMS:</b> install the observer on the phone receiving bank credit messages. Grant the required permissions, scan the pairing QR from Alerts &amp; observers, and keep the background service running.')
p('<b>Gmail:</b> enter your Google OAuth client settings in Alerts &amp; observers. Register the displayed callback URI, connect the inbox that receives bank credit emails and run the connection test. The account owner must authorize access.')
h('If the customer paid but the order is pending')
p('Do not ask them to pay again. Compare the bank credit with the receiving UPI account, amount and 12-digit reference. Let the observer match the real bank record. If more than one same-amount order could match, hold the credit for review instead of assigning it to the newest order.')
p('An authorized merchant can confirm a receipt after checking the bank. That decision must remain labelled merchant-confirmed in the audit trail. It must not create a fictional bank observation.')
h('Refunds and recipient splits')
p('Refund requests, platform fees and recipient allocations can be tracked in the console. A recorded allocation or refund request does not send funds. Outgoing transfers need bank action or a separately configured provider. Save the actual transfer reference after the money is sent.')

page('Daily operations and troubleshooting')
h('Before you share your payment link')
p('1. Use a stable HTTPS gateway address.<br/>2. Store API and signing secrets only on your backend.<br/>3. Confirm the receiving UPI ID and channel limits.<br/>4. Connect and test a bank observer.<br/>5. Verify signed callbacks and exact order amounts.<br/>6. Test repeated requests, queued payments, cancellations and delayed credits.<br/>7. Check the first real bank receipt and dashboard result together.')
h('Callback delivery')
p('Each delivery has a ten-second timeout and up to five total attempts. Any non-2xx response or network error is retried. The waits after an unsuccessful attempt are 5 seconds, 30 seconds, 2 minutes and 10 minutes, plus scheduler delay. Delivery ID and payload stay the same across retries.')
p('The signature covers the payload, not the timestamp header. Keep durable delivery-ID and order deduplication; a timestamp check alone does not stop a replay. If delivery attempts run out, reconcile through the status API and your merchant operations process.')
h('Common responses')
table(['HTTP','What to check'],[['400','Amount, field format, channel toggle or receiving-UPI allowlist.'],['401','Client-ID, Client-Secret and Service-Id.'],['403','Your server IP allowlist or merchant ownership.'],['404','Transaction ID, IFSC or endpoint path.'],['409','Same order ID with a different amount, or an inactive QR.'],['429','Honour Retry-After. The configured default is 1,000 requests per IP per 60-second window.'],['5xx','Connection, provider or gateway configuration. Keep the same order ID when retrying an uncertain creation request.']],[55,440])
h('A UPI app does not open')
p('On a laptop, scan the QR with your phone. On a phone, choose an installed UPI app and return to checkout after paying. App launching depends on the device, browser, installed apps and bank acceptance. Keep the QR option available.')
p('Keep this manual with your integration records. For a payment issue, note the merchant order ID, Dynamo Pay transaction ID, amount, receiving UPI ID, bank reference and approximate payment time. Never share an OTP, UPI PIN or client secret.','small')

page('Credentials and account access')
p('Your console login and API credentials serve different purposes. Use the email and password to manage the business. Use the merchant API credentials on your server to create payments and read their status.')
table(['Credential','Purpose'],[['Console email and password','Sign in to the Merchant Console. Supplied in your private account handover.'],['Client-ID','Identifies your merchant when calling the payment API.'],['Client-Secret','Authenticates your server requests. Send it in the Client-Secret header.'],['Service-Id','Your assigned merchant identifier; use the same value across the documented endpoints.'],['Publishable key','Identifies the merchant in a supported browser checkout integration.'],['Webhook signing secret','Verifies payment callback signatures on your server.'],['Webhook URL','Your public HTTPS endpoint for receiving payment updates.']],[153,342])
h('Find your keys')
p('Sign in, open <b>Developer tools</b>, and copy the credentials into your server environment. Keep the values together under the correct merchant account. Confirm the callback URL before accepting customer payments.')
code('DYNAMO_BASE_URL=https://your-assigned-gateway.example\nDYNAMO_CLIENT_ID=your-client-id\nDYNAMO_CLIENT_SECRET=your-client-secret\nDYNAMO_SERVICE_ID=your-service-id\nDYNAMO_WEBHOOK_SECRET=your-webhook-signing-secret')
h('Example authenticated request')
code('curl -X POST "$DYNAMO_BASE_URL/v1.0/wallet" \\\n  -H "Client-ID: $DYNAMO_CLIENT_ID" \\\n  -H "Client-Secret: $DYNAMO_CLIENT_SECRET" \\\n  -H "Service-Id: $DYNAMO_SERVICE_ID" \\\n  -H "Content-Type: application/json" \\\n  -d \'{}\'')
p('Place secret values in your backend environment. Share only the public manual and publishable integration details with frontend developers. Internal administrator and observer tokens belong to the service configuration.','small')

page('Successful checks and common questions')
p('The completed automated checks below passed on 31 October 2026. The detailed test report and route inventory are available from the Developer API page.')
table(['Check','Result'],[['331 automated tests across 42 suites','Successful'],['183 registered routes: access and invalid-input smoke checks','Successful'],['200 unique orders with queue scheduling','Successful'],['50 repeated requests resolved to one transaction','Successful'],['1,001 stored receiving accounts','Successful'],['10 merchants with parallel, matched simulated confirmations','Successful'],['Callback retries, signatures and attempt limits','Successful'],['Per-IP request limits and forwarding-header protection','Successful']],[395,100])
h('How many payments can I accept at once?')
p('Normal routing keeps one checkout active per receiving account and queues the next orders. The capacity check accepted all 200 test orders and completed their simulated confirmations. Ten separate merchants were also checked in parallel. These figures describe the tested application behaviour; bank completion time depends on actual payments and notification delivery.')
h('Where should my team work each day?')
p('Use <b>Overview</b> for collections and items needing attention, <b>Transactions</b> for payment details, and <b>Refunds</b> or <b>Split payments</b> for the related operations. Use <b>UPI Accounts</b> for receiving settings and <b>Connections &amp; alerts</b> for SMS and Gmail.')
h('What should I tell a customer who has already paid?')
p('Ask for their order ID and bank reference. Check the receiving account and amount, then follow the pending payment through reconciliation. Confirm the result from the bank record before asking the customer to make another payment.')
h('Can this manual be shared with customers?')
p('Yes. Share this manual for setup and operating guidance. Provide each customer only their own assigned merchant credentials through a private handover.')

def footer(c,doc):
    w,h=doc.pagesize;c.setFillColor(VIOLET);c.rect(0,h-7,w,7,fill=1,stroke=0)
    c.setStrokeColor(LINE);c.line(50,43,w-50,43)
    c.setFont('Segoe',8);c.setFillColor(MUTED);c.drawString(50,28,'Dynamo Pay  |  Merchant & API user manual  |  v1.1')
    c.drawRightString(w-50,28,str(doc.page))
    if doc.page>1:c.setFont('SegoeBold',9);c.setFillColor(NAVY);c.drawString(50,h-34,'Dynamo Pay')

doc=SimpleDocTemplate(str(OUT),pagesize=(595.28,841.89),rightMargin=50,leftMargin=50,topMargin=59,bottomMargin=62,title='Dynamo Pay - Payment API Integration Manual',author='Dynamo Pay',subject='Merchant API setup, UPI payments and payment verification')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
public=ROOT/'apps/merchant-admin/public/dynamo-pay-manual.pdf';shutil.copyfile(OUT,public)
print(OUT)
