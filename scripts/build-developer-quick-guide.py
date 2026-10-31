"""Three-page developer handover; public examples only, no live credentials."""
from pathlib import Path
from xml.sax.saxutils import escape
import shutil
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Preformatted, Flowable
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf/Dynamo-Pay-Developer-Quick-Guide.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
for name,file in [('Regular','segoeui.ttf'),('Bold','segoeuib.ttf'),('Mono','consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
INK=colors.HexColor('#173b30');GREEN=colors.HexColor('#19634d');MUTED=colors.HexColor('#5d6e66');LINE=colors.HexColor('#dce7df');PALE=colors.HexColor('#eef4ef')
styles={name:ParagraphStyle(name,fontName=font,fontSize=size,leading=leading,textColor=INK,spaceAfter=space) for name,font,size,leading,space in [('title','Bold',25,31,8),('h2','Bold',12,17,6),('body','Regular',9.5,14,8),('small','Regular',8.2,11.5,6),('code','Mono',8,11,9)]}
styles['code'].backColor=PALE;styles['code'].borderPadding=9
story=[]
def p(text,style='body'):story.append(Paragraph(text,styles[style]))
def h(text):p(text,'h2')
def code(text):story.append(Preformatted(text,styles['code']));story.append(Spacer(1,5))
def table(headers,rows,widths):
    data=[[Paragraph(escape(str(v)),styles['small']) for v in row] for row in [headers]+rows]
    t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,-1),.5,LINE)]))
    story.append(t);story.append(Spacer(1,10))
def page(number,title):
    if story:story.append(PageBreak())
    p(f'DYNAMO PAY  /  DEVELOPER GUIDE  /  {number} OF 3','small');p(title,'title')

class PaymentFlow(Flowable):
    def __init__(self):
        super().__init__()
        self.width=495;self.height=148
    def draw(self):
        c=self.canv
        def arrow(x1,y1,x2,y2):
            c.setStrokeColor(GREEN);c.setLineWidth(1);c.line(x1,y1,x2,y2)
            if x2>x1:c.line(x2,y2,x2-4,y2+3);c.line(x2,y2,x2-4,y2-3)
            else:c.line(x2,y2,x2-3,y2+4);c.line(x2,y2,x2+3,y2+4)
        def box(x,y,title,detail):
            c.setFillColor(PALE);c.setStrokeColor(LINE);c.roundRect(x,y,149,40,5,fill=1,stroke=1)
            c.setFillColor(INK);c.setFont('Bold',9);c.drawCentredString(x+74.5,y+24,title)
            c.setFont('Regular',8);c.drawCentredString(x+74.5,y+10,detail)
        box(0,104,'Customer website','Starts an order');box(173,104,'Your backend','Keeps API secrets');box(346,104,'Dynamo Pay API','Creates checkout URL')
        arrow(151,124,170,124);arrow(324,124,343,124)
        c.setStrokeColor(GREEN);c.line(420,104,420,91);c.line(420,91,74,91);arrow(74,91,74,66)
        c.setFont('Regular',8);c.setFillColor(MUTED);c.drawCentredString(250,77,'Customer opens QR / UPI, pays, and the bank sends an alert')
        box(0,24,'Android SMS / Gmail','Receives bank evidence');box(173,24,'Match and confirm','Account + amount + reference');box(346,24,'Payment updates','Dashboard + signed callback')
        arrow(151,44,170,44);arrow(324,44,343,44)

page(1,'Connect your website')
p('A compact guide for integrating Dynamo Pay, understanding operating limits, and following bank confirmations. Version 1.0 • 31 October 2026. Examples use placeholders; obtain your own credentials from the account owner.')
story.append(PaymentFlow());story.append(Spacer(1,5))
h('1. Prepare the server connection')
p('Use the assigned HTTPS gateway origin as <b>BASE_URL</b>. In the Merchant Console, open <b>Developer tools</b> for credentials and webhook settings. Your backend calls the API; your browser opens the returned checkout. Keep Client-Secret and the webhook signing secret on your server.')
table(['Required header','Value'],[['Client-ID','Your merchant client ID'],['Client-Secret','Your merchant API secret'],['Service-Id','Your assigned merchant ID; use it across all endpoints'],['Content-Type','application/json']],[137,358])
h('2. Create the payment')
code('POST BASE_URL/v1.0/collect/upi\n\n{\n  "amount": "201.00",\n  "uniquetransactionid": "ORDER-1001",\n  "name": "Customer name",\n  "emailid": "customer@example.com",\n  "mobileno": "9876543210"\n}')
p('Amount and uniquetransactionid are required. Send rupees with up to two decimals. Save one unique ID per order before requesting payment. Current saved channel limits are <b>₹200–₹20,000</b>; the API floor is ₹100 and the higher configured minimum applies.')
h('3. Open checkout and save the reference')
p('Save <b>transaction</b> and redirect to <b>checkoutUrl</b>. Active orders also return <b>qr</b> (SVG image URL) and <b>intent</b> (UPI app URI). A queued order has no payable QR or intent until activation. A successful create response means the order exists; payment is confirmed separately.')

page(2,'Status, callbacks and limits')
table(['Function','Method','Path'],[['Create a payment','POST','/v1.0/collect/upi'],['Check payment status','POST','/v1.0/payin/checkstatus'],['Look up IFSC','POST','/v1.0/ifsc/{ifsc}'],['Read accounting wallet','POST','/v1.0/wallet'],['Save callback / server IP list','POST','/v1.0/merchant/webhook']],[137,50,308])
h('Read status or receive a signed callback')
code('POST BASE_URL/v1.0/payin/checkstatus\n{ "uniquetransactionid": "ORDER-1001" }')
p('Send the same authentication headers. <b>PENDING</b> means wait; <b>SUCCESS</b> means confirmed; <b>FAILED</b> represents a failed, expired or cancelled attempt. Read <b>internalStatus</b> for the precise state. Poll no faster than once every five seconds and stop when final.')
p('For callbacks, configure your public HTTPS endpoint and verify <b>X-Gateway-Signature</b>: <b>sha256=</b> plus HMAC-SHA256 of the original request bytes, using your webhook signing secret. Compare securely, match merchant/order/amount/currency/method, and deduplicate <b>X-Gateway-Delivery-Id</b>. Persist the event and return HTTP 200. Do not fulfil from a customer click alone.')
p('Callbacks have a ten-second request timeout and up to five attempts in total. Retry waits are 5 seconds, 30 seconds, 2 minutes and 10 minutes, plus scheduler delay. Reconcile exhausted deliveries through the status API.','small')
h('Request limits and safe retries')
table(['Control','Current behaviour'],[['API requests per IP','1,000 per 60-second fixed window; creation and status polling share the allowance.'],['Over the limit','HTTP 429 with Retry-After. Wait and retry with backoff.'],['Repeated creation','Same order ID + same amount returns the existing order. Changed amount returns 409.'],['IP and receiving-UPI restrictions','Server IP allowlist accepts exact IPs. The separate beneficiary allowlist supports up to 100 receiving VPAs.']],[158,337])
p('The rate counter is per process and resets on restart; health endpoints and /events paths are exempt. An API-request allowance is not a successful-payments-per-minute guarantee.','small')
h('How many UPI accounts and checkouts?')
p('<b>Storage:</b> 1,001 receiving accounts were tested for one merchant; this is a measured count, not a certified maximum. <b>Normal routing:</b> one selected active receiving account per merchant and one active checkout per receiving account. Later orders queue. Adding stored UPIs does not create automatic load balancing.')
p('<b>Capacity checks:</b> 200 unique orders were accepted (one active, 199 queued), then completed with simulated bank confirmations. Ten separate merchants were tested in parallel. These are local application tests, not measured real-bank throughput.','small')

page(3,'Observers and dashboard timing')
h('Android SMS: connect the receiving phone')
p('Download the supplied observer APK from <b>Connections &amp; alerts</b> onto the Android phone receiving bank SMS. Generate the pairing QR on your laptop and choose <b>Scan pairing QR</b> on the phone. Grant permissions, allow background activity and keep internet available. The QR expires after ten minutes. Check the device heartbeat in the console.')
h('Gmail: connect the bank-alert inbox')
p('Enter your Google OAuth client ID and secret in <b>Connections &amp; alerts</b>, with Gmail API access enabled. Register the exact <b>Authorized redirect URI</b>, save, choose <b>Connect Gmail</b>, and authorise the bank-alert inbox. Run <b>Test connection</b>. Update the redirect URI if the gateway address changes.')
h('How quickly does Successful appear?')
table(['Stage','Timing and meaning'],[['Bank sends SMS or email','Bank-controlled; may arrive after the transfer. No fixed delivery time is guaranteed.'],['Android submits the SMS','When the supported message arrives and the running app can reach your server; phone/network delays apply.'],['Gmail checks the inbox','Every 5 seconds by default while the observer service runs, plus network and processing time.'],['Dynamo Pay matches the credit','Checks receiving account, amount, reference and eligible order. Ambiguous evidence stays for review.'],['Dashboard shows the result','Overview, Transactions and Failed payments refresh every 20 seconds while the tab is visible. Refresh data checks immediately.']],[155,340])
p('<b>With both connected:</b> the first valid match can confirm the order without waiting for both channels. The other channel may add evidence. Supported duplicate notifications are checked to avoid assigning the same credit again.')
p('<b>Practical expectation:</b> once Successful is saved, it normally appears on the next dashboard refresh: within 20 seconds plus request time. Total timing also includes bank delivery, observer submission and verification; there is no guaranteed end-to-end time.')
h('If the customer paid but the order is pending')
p('Ask for the order ID and 12-digit UTR; check the receiving account and exact amount. In the reported-payment verification flow, missing confirmation stays <b>VERIFICATION_PENDING</b> for reconciliation. A typed UTR or Payment done click is a claim, not bank proof. Restore the observer and match the real credit; do not ask the customer to pay again automatically.')
h('Before the business starts accepting payments')
p('Keep the server and observers online, maintain backups, and verify a real credit, dashboard update and signed callback together. Refund and split records track work; bank transfers need a configured rail or bank action. There is no zero-failure guarantee.')
p('More detail: open /downloads on your assigned gateway for the full manual. This public guide contains no passwords or live API secrets.','small')

def footer(c,doc):
    c.setFillColor(GREEN);c.rect(0,835,595.28,7,fill=1,stroke=0)
    c.setStrokeColor(LINE);c.line(50,45,545,45)
    c.setFont('Regular',8);c.setFillColor(MUTED);c.drawString(50,29,'Dynamo Pay  |  Developer integration & operations  |  31 October 2026');c.drawRightString(545,29,f'{doc.page} / 3')
SimpleDocTemplate(str(OUT),pagesize=(595.28,841.89),leftMargin=50,rightMargin=50,topMargin=46,bottomMargin=60,title='Dynamo Pay - Developer Quick Guide',author='Dynamo Pay').build(story,onFirstPage=footer,onLaterPages=footer)
shutil.copyfile(OUT,ROOT/'apps/merchant-admin/public/dynamo-developer-quick-guide.pdf')
print(OUT)
