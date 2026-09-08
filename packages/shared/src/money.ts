/** Monetary values are integer PKR minor units; never use floating-point values. */
export const formatMoney=(minor:number,currency='PKR')=>new Intl.NumberFormat('en-PK',{style:'currency',currency,minimumFractionDigits:0}).format(minor);
