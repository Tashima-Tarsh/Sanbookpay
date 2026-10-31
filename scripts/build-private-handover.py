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
p('The console password is set to the value shown on page 1. Local restarts retain the saved password hash. A temporary Cloudflare address may change when the tunnel restarts; check the current address before updating a customer integration.')
p('Google OAuth and external payment-provider credentials are supplied by their account owners. This handover lists the Dynamo Pay credentials available for this installation; it does not create external account credentials.')
p('Keep this private handover with your account records. The public user manual and test report can be shared separately.','small')
p('To download this PDF in an external browser, open the document downloads address on page 1, sign in with your console account and choose Download private credentials.','small')
def footer(c,doc):
    c.setFillColor(green);c.rect(0,835,595.28,7,fill=1,stroke=0)
    c.setFont('Regular',8);c.setFillColor(ink);c.drawString(50,30,'Dynamo Pay  |  Private account credentials  |  Owner copy');c.drawRightString(545,30,str(doc.page))
out=folder/'Dynamo-Pay-Private-Credentials.pdf'
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),leftMargin=50,rightMargin=50,topMargin=55,bottomMargin=60,title='Dynamo Pay - Private Account Handover',author='Dynamo Pay').build(story,onFirstPage=footer,onLaterPages=footer)
print('Private credential PDF created in the ignored local secrets folder.')
