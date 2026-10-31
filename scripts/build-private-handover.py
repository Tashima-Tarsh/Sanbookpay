"""Create an owner-only account handover from ignored local credentials."""
from pathlib import Path
import json
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'data/.secrets'
account=json.loads((folder/'manual-handover.json').read_text(encoding='utf-8'))
credentials=account['credentials']
for name,file in [('Regular','segoeui.ttf'),('Bold','segoeuib.ttf'),('Mono','consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
ink=colors.HexColor('#162c29');green=colors.HexColor('#16624e')
styles={k:ParagraphStyle(k,fontName=font,fontSize=size,leading=leading,textColor=ink,spaceAfter=10,wordWrap='LTR') for k,font,size,leading in [('title','Bold',28,34),('h2','Bold',12,18),('body','Regular',10,15),('small','Regular',8.5,12),('value','Mono',8,12)]}
story=[]
def p(text,style='body'):story.append(Paragraph(text,styles[style]))
def table(rows):
    data=[[Paragraph(escape(str(label)),styles['small']),Paragraph(escape(str(value)),styles['value'])] for label,value in rows]
    t=Table(data,colWidths=[145,350],hAlign='LEFT')
    t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(0,-1),colors.HexColor('#edf4f0')),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),.5,colors.HexColor('#dbe6e0'))]))
    story.append(t);story.append(Spacer(1,18))
p('Dynamo Pay','title');p('Private account handover','h2')
p('Prepared for the account owner • 31 October 2026','small')
p('Console access','h2')
table([('Merchant console',account['origin']+'/admin'),('Document downloads',account['origin']+'/downloads'),('Email',account['email']),('Password',account['password']),('Gateway base URL',account['origin'])])
p('Merchant API credentials','h2')
table([('Client-ID',credentials['clientId']),('Client-Secret',credentials['clientSecret']),('Service-Id',credentials['serviceId']),('Publishable key',credentials['publishableKey']),('Webhook signing secret',credentials['webhookSecret']),('Webhook URL',credentials.get('webhookUrl') or 'Set your customer server callback in Developer tools.')])
p('Access checked successfully: console sign-in and an authenticated wallet API request. Use these values with the Dynamo Pay Merchant &amp; API User Manual.','small')
story.append(PageBreak())
p('Service administration','title')
p('Owner and server administrator access','h2')
p('These tokens connect the internal services. Customer integrations use the merchant credentials on the previous page.')
table([('Administrator API token',account['adminToken']),('Observer API token',account['observerToken']),('Internal service token',account['internalServiceToken'])])
p('Where each credential belongs','h2')
table([('Payment API authentication','Client-ID, Client-Secret and Service-Id headers'),('Webhook verification','HMAC-SHA256 using the webhook signing secret'),('Internal administration','Authorization: Bearer <administrator API token>'),('SMS / Gmail ingestion','Authorization: Bearer <observer API token>'),('Trusted local proxy','x-gateway-token: <internal service token>')])
p('Account notes','h2')
p('The console password is set to the value shown on page 1. Local restarts retain the saved password hash. The hosted Render URL is the canonical origin. Free hosting can sleep; the free database expires on 30 November 2026. Back up before changing hosting.')
p('Google OAuth and external payment-provider credentials are supplied by their account owners. This handover lists the Dynamo Pay credentials available for this installation; it does not create external account credentials.')
p('Keep this private handover with your account records. The public user manual and test report can be shared separately.','small')
p('To download this PDF in an external browser, open the document downloads address on page 1, sign in with your console account and choose Download private credentials.','small')
story.append(PageBreak())
p('Private operations setup','title')
p('Configure without changing existing keys','h2')
p('Use the public configuration manual for website integration, Android pairing and Google consent steps. Keep this owner copy access-controlled. Do not upload it to GitHub, email it to customers or copy server tokens into frontend code.')
table([('DATABASE_URL','Render environment; managed PostgreSQL connection string. Required for hosted durability.'),('ENCRYPTION_MASTER_KEY','Original encryption master key in Render secrets. Required; preserve when restoring data.'),('JWT_SECRET','Existing JWT signing secret in Render secrets. Required.'),('INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD','Initial provisioning only; persisted console password hash remains authoritative.'),('ADMIN_API_TOKEN','Internal administration only. Existing ignored admin_api_token file or secret environment.'),('OBSERVER_API_TOKEN','Internal observer-to-API bearer. Existing ignored observer_api_token file or secret environment.'),('ANDROID_ENROLLMENT_SECRET','Pairing QR enrollment only; devices receive their own signing key.'),('GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET','Google Web OAuth client. Save in the selected merchant Gmail configuration.'),('GMAIL_RECEIVING_ACCOUNT_ID','Bind the inbox to its real receiving-account UUID; do not use a global newest-order lookup.'),('GMAIL_REDIRECT_URI',account['origin']+'/oauth/callback'),('GMAIL_POLL_INTERVAL_MS','Default 5000; host must be awake.'),('Provider client credentials','Obtain from the approved provider account. They are not created by Dynamo Pay.'),('Android release signing key','DYNAMO_ANDROID_KEYSTORE, DYNAMO_ANDROID_KEYSTORE_PASSWORD and DYNAMO_ANDROID_KEY_ALIAS; reuse the original private signing identity.'),('Android build tools','Set JAVA_HOME and ANDROID_HOME. Requires SDK platform 34, build-tools 34.0.0 (or ANDROID_BUILD_TOOLS_VERSION). Run node scripts/build-android-apk.js. The build verifies signing and writes APK/source hashes; production rejects missing/stale release manifests.')])
story.append(PageBreak())
p('Validation and recovery','title')
p('Connection checks','h2')
p('Android: install the newly built signed APK, grant SMS/notification permissions, pair from Connections & alerts, check signed heartbeat, reconnect after offline and reboot, then verify a genuine credit. The old bundled APK is not the hardened source build. Gmail: enable Gmail API, configure consent/test user and exact redirect URI, connect the bank-alert inbox, bind its receiving account, run Test Gmail, then verify a genuine alert. Notifications remain supplementary evidence; provider confirmation or explicit owner bank review is required.')
p('Credentials and backups','h2')
p('Retain the original ignored configuration and a consistent database snapshot. Hosted private files are stored in hosted_files and restored on startup. This is access control and provider storage, not a separate encrypted vault. Restrict database operators and backup access. Never rotate the encryption key in place: decrypt/re-encrypt using a tested migration. API/webhook rotation requires coordinating both sender and receiver before retiring the previous credential. No credentials are rotated by this manual generator.')
p('Test and troubleshooting','h2')
p('Verify login, authenticated wallet/status, protected PDF download and anonymous rejection. Check /_ready, failed callback counts and unmatched observations. For a refund timeout, preserve the same refundId and reconcile with the provider. For invalid_grant reconnect Google; for redirect_uri_mismatch fix the exact callback URI. For Android 401 verify pairing, current device clock and signed heartbeat support. Do not submit synthetic bank messages to a live account. Review isolated tests before source freeze; no production records may be reset.')
p('Freeze and recovery','h2')
p('Record source commit, release tag, PDF hashes and backup date. Restore to a separate database first. Retain original encryption/JWT keys and owner access. Verify record counts and amounts before promoting a restore. A source rollback does not undo bank transfers or database writes. Keep an external bank/provider ledger for reconciliation. An always-on guarantee requires hosting and provider arrangements beyond this free trial.')

def footer(c,doc):
    c.setFillColor(green);c.rect(0,835,595.28,7,fill=1,stroke=0)
    c.setFont('Regular',8);c.setFillColor(ink);c.drawString(50,30,'Dynamo Pay  |  Private account credentials  |  Owner copy');c.drawRightString(545,30,str(doc.page))
out=folder/'Dynamo-Pay-Private-Credentials.pdf'
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),leftMargin=50,rightMargin=50,topMargin=55,bottomMargin=60,title='Dynamo Pay - Private Account Handover',author='Dynamo Pay').build(story,onFirstPage=footer,onLaterPages=footer)
print('Private credential PDF created in the ignored local secrets folder.')
