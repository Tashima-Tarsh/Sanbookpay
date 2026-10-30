export function upiChannelSettings(merchant){
  return merchant?.branding?.upiChannel || {enabled:true,minAmountPaise:20000,maxAmountPaise:2000000,allowedVpas:[]};
}
export function validateUpiChannel(merchant,amountPaise,vpa){
  const c=upiChannelSettings(merchant);
  // Existing installations keep their current limits until the settings are saved.
  if(!merchant?.branding?.upiChannel)return null;
  if(!c.enabled)return {code:'UPI_CHANNEL_DISABLED',error:'UPI payment channel is disabled.'};
  if(amountPaise<BigInt(c.minAmountPaise)||amountPaise>BigInt(c.maxAmountPaise))return {code:'AMOUNT_OUT_OF_RANGE',error:`UPI amount must be between INR ${(c.minAmountPaise/100).toFixed(2)} and INR ${(c.maxAmountPaise/100).toFixed(2)}.`};
  if(c.allowedVpas.length&&!c.allowedVpas.some(value=>value.toLowerCase()===String(vpa).toLowerCase()))return {code:'UPI_NOT_WHITELISTED',error:'Receiving UPI ID is not on the merchant allowlist.'};
  return null;
}
