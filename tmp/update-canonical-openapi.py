from pathlib import Path
import json
p=Path('apps/merchant-admin/public/dynamo-openapi.json');doc=json.loads(p.read_text(encoding='utf8'))
doc['info']['version']='2.0.0'
doc['info']['description']='Preferred integration: scoped bearer /v1/payments. Legacy Client-ID routes remain separate. Positive INR amounts are subject to saved limits. Notification acceptance is labelled NOTIFICATION and bankVerified=false, not independent bank verification.'
doc['servers']=[{'url':'https://dynamo-pay.onrender.com'}]
components=doc.setdefault('components',{});components.setdefault('securitySchemes',{})['MerchantBearer']={'type':'http','scheme':'bearer','description':'Merchant-scoped dp_live_ or dp_test_ secret. Backend only.'}
security=[{'MerchantBearer':[]}]
idem={'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','pattern':'^[-A-Za-z0-9_:]{1,120}$'}}
amount={'oneOf':[{'type':'string','pattern':r'^\d+(\.\d{1,2})?$'},{'type':'number','exclusiveMinimum':True,'minimum':0}]}
body={'type':'object','required':['amount'],'properties':{'amount':amount,'currency':{'type':'string','enum':['INR']},'orderId':{'type':'string','maxLength':120},'playerReference':{'type':'string','maxLength':200},'returnUrl':{'type':'string','format':'uri','description':'Absolute HTTPS return page. Navigation is not payment confirmation.'}}}
response={'description':'Payment state and hosted checkout URL'}
response['content']={'application/json':{'schema':{'type':'object','properties':{'paymentId':{'type':'string'},'orderId':{'type':'string'},'checkoutUrl':{'type':'string','format':'uri'},'status':{'type':'string'},'confirmationSource':{'type':'string','nullable':True},'amountPaise':{'type':'string'}}}}}
operation={'summary':'Create/replay a payment (payments.create)','security':security,'parameters':[idem]}
operation['requestBody']={'required':True,'content':{'application/json':{'schema':body}}}
operation['responses']={'201':response,'200':response,'401':{'description':'Invalid key'},'403':{'description':'Scope, IP, policy or inactive merchant'},'409':{'description':'Idempotency conflict'},'429':{'description':'Rate limited; observe Retry-After'}}
doc['paths']['/v1/payments']={'post':operation}
doc['paths']['/v1/payments/{paymentId}']={'get':{'summary':'Read status (payments.read)','security':security,'parameters':[{'name':'paymentId','in':'path','required':True,'schema':{'type':'string'}}],'responses':{'200':response,'404':{'description':'Payment absent or belongs to another merchant'}}}}
refund={'summary':'Create/replay a supported provider refund (refunds.create)','security':security,'parameters':[idem]}
refund['requestBody']={'required':True,'content':{'application/json':{'schema':{'type':'object','required':['paymentId'],'properties':{'paymentId':{'type':'string'},'amount':amount,'refundId':{'type':'string'},'reason':{'type':'string'}}}}}}
refund['responses']={'201':{'description':'Refund reserved/submitted'},'200':{'description':'Original refund returned'},'409':{'description':'Idempotency or refundable-balance conflict'}}
doc['paths']['/v1/refunds']={'post':refund}
components.setdefault('schemas',{})['MerchantCallback']={'type':'object','description':'Verify X-Gateway-Signature HMAC-SHA256 over raw bytes. Deduplicate delivery ID and payment/order atomically with game-wallet credit. PAYMENT_DETECTED is PENDING.','properties':{'event':{'type':'string'},'merchantId':{'type':'string'},'paymentId':{'type':'string'},'orderId':{'type':'string'},'amountPaise':{'type':'integer'},'currency':{'type':'string','enum':['INR']},'status':{'type':'string'},'utr':{'type':'string','nullable':True},'playerReference':{'type':'string','nullable':True},'confirmationSource':{'type':'string','nullable':True},'bankVerified':{'type':'boolean','description':'false for notification acceptance'}}}
p.write_text(json.dumps(doc,indent=2)+'\n',encoding='utf8')
